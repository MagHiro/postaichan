import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type QueryResultRow } from "pg";
import { getReport } from "../lib/reports.ts";
import { midtransEventIdentity, midtransSignature, verifyMidtransSignature } from "../lib/payments/midtrans-webhook.ts";
import { processRefundAttemptCore, reconcileRefundAttemptCore, type RefundQuery } from "../lib/payments/refund-workflow-core.ts";
import type { PaymentProvider } from "../lib/payments/provider.ts";
import { midtransWebhookSchema } from "../lib/schemas.ts";
import { rateLimitKey } from "../lib/security/http.ts";

const runtimeUrl = process.env.DATABASE_TEST_URL;
const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;

function assertIsolatedDatabase(url: string | undefined, label: string) {
  assert.ok(url, `${label} is required; database integration tests never skip`);
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\/+/, "");
  assert.match(databaseName, /(?:^|[_-])(?:test|integration|ci)(?:$|[_-])/i, `${label} must use an explicitly marked test database`);
  return { parsed, databaseName };
}

async function withClient<T>(connectionString: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try { return await run(client); }
  finally { await client.end(); }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const passwordHash = () => `scrypt$16384$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(64).toString("base64url")}`;

test("PostgreSQL 16 production invariants, checkout, provider races, reconciliation, refunds, shifts, and staff lifecycle", async (t) => {
  const runtimeDb = assertIsolatedDatabase(runtimeUrl, "DATABASE_TEST_URL");
  const adminDb = assertIsolatedDatabase(adminUrl, "DATABASE_TEST_ADMIN_URL");
  assert.equal(runtimeDb.databaseName, adminDb.databaseName, "admin and runtime test connections must reach the same isolated database");

  const admin = new pg.Client({ connectionString: adminUrl });
  const runtime = new pg.Client({ connectionString: runtimeUrl });
  await admin.connect();
  await runtime.connect();
  let currentShiftId: string | null = null;

  const independentRuntime = <T>(run: (client: pg.Client) => Promise<T>) => withClient(runtimeUrl!, run);
  const createSession = async (tableId: string, extra: Record<string, unknown> = {}) => {
    const tokenHash = hash(randomUUID());
    const currentTableVersion = extra.tableQrVersion ?? (await admin.query("select qr_token_version from public.restaurant_tables where id=$1", [tableId])).rows[0]?.qr_token_version;
    await admin.query(
      `insert into public.customer_sessions(access_token_hash, order_type, table_id, expires_at,
        table_qr_version, source_table_id, source_table_qr_version, ordering_qr_code_id, ordering_qr_token_version)
       values ($1, 'dine_in', $2, timezone('utc', now()) + interval '2 hours', $3, $4, $5, $6, $7)`,
      [tokenHash, tableId, currentTableVersion ?? null, extra.sourceTableId ?? null, extra.sourceTableQrVersion ?? null, extra.orderingQrId ?? null, extra.orderingQrVersion ?? null],
    );
    return tokenHash;
  };
  const itemFor = (productId: string, quantity = 1, variantOptionIds: string[] = [], addonOptionIds: string[] = []) => [{ productId, quantity, variantOptionIds, addonOptionIds }];
  const checkout = async (options: {
    productId: string; sessionHash?: string | null; actorId?: string | null; tableId?: string | null;
    method?: "qris" | "cash"; key?: string; fingerprint?: string; quantity?: number; variantOptionIds?: string[]; addonOptionIds?: string[];
  }) => {
    const key = options.key ?? randomUUID();
    const sessionHash = options.sessionHash ?? null;
    const actorId = options.actorId ?? null;
    const paymentMethod = options.method ?? "qris";
    const items = itemFor(options.productId, options.quantity ?? 1, options.variantOptionIds ?? [], options.addonOptionIds ?? []);
    const fingerprint = options.fingerprint ?? hash(JSON.stringify({ items, paymentMethod }));
    const result = await runtime.query(
      "select * from public.create_checkout_intent($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::public.payment_method, $7::jsonb)",
      [key, fingerprint, sessionHash, options.tableId ?? null, actorId, paymentMethod, JSON.stringify(items)],
    );
    return result.rows[0] as {
      order_id: string; order_number: string; payment_id: string; payment_status: string; amount_idr: number;
      provider_order_id: string; qr_string: string | null; created_at: string | Date; expires_at: string | Date | null; replayed: boolean;
    };
  };
  const settle = async (paymentId: string, settledAt = new Date().toISOString(), providerStatus = "settlement") => runtime.query(
    "select * from public.apply_payment_transition($1::uuid, 'settled'::public.payment_status, $2, $3, 0, $4::timestamptz)",
    [paymentId, providerStatus, `txn-${randomUUID()}`, settledAt],
  );
  const expire = async (paymentId: string) => runtime.query(
    "select * from public.apply_payment_transition($1::uuid, 'expired'::public.payment_status, 'expire', null, 0, null)",
    [paymentId],
  );

  try {
    const migrationVersions = await admin.query<{ version: string }>("select version from public.schema_migrations order by version");
    assert.ok(migrationVersions.rows.some((row) => row.version === "001_initial.sql"));
    assert.ok(migrationVersions.rows.some((row) => row.version === "027_provider_order_id_length_fix.sql"));
    assert.ok(migrationVersions.rows.some((row) => row.version === "050_public_qris_reservation_capacity.sql"));

    const identity = await runtime.query<{ current_user: string; is_superuser: boolean; runtime_member: boolean; ddl_member: boolean; can_create_public: boolean; owns_objects: boolean; can_update_payments: boolean; can_execute_internal_auth: boolean; can_execute_legacy_refund: boolean; can_execute_current_refund: boolean; runtime_group_safe: boolean; ddl_group_safe: boolean }>(
      `select current_user,
              r.rolsuper as is_superuser,
              pg_has_role(current_user, 'postaichan_runtime', 'member') as runtime_member,
              pg_has_role(current_user, 'postaichan_ddl', 'member') as ddl_member,
              has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
              exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid)
                or exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proowner = r.oid) as owns_objects,
              has_table_privilege(current_user, 'public.payments', 'UPDATE') as can_update_payments,
              has_function_privilege(current_user, 'public.is_admin_actor(uuid)', 'EXECUTE') as can_execute_internal_auth,
              has_function_privilege(current_user, 'public.claim_payment_refund(uuid,integer)', 'EXECUTE') as can_execute_legacy_refund,
              has_function_privilege(current_user, 'public.claim_payment_refund(uuid,integer,text,uuid,uuid)', 'EXECUTE') as can_execute_current_refund,
              exists(select 1 from pg_roles where rolname='postaichan_runtime' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as runtime_group_safe,
              exists(select 1 from pg_roles where rolname='postaichan_ddl' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as ddl_group_safe
       from pg_roles r where r.rolname = current_user`,
    );
    const runtimeRole = identity.rows[0];
    assert.ok(runtimeRole);
    assert.equal(runtimeRole.is_superuser, false);
    assert.equal(runtimeRole.runtime_member, true);
    assert.equal(runtimeRole.ddl_member, false);
    assert.equal(runtimeRole.can_create_public, false);
    assert.equal(runtimeRole.owns_objects, false);
    assert.equal(runtimeRole.can_update_payments, false);
    assert.equal(runtimeRole.can_execute_internal_auth, false);
    assert.equal(runtimeRole.can_execute_legacy_refund, false);
    assert.equal(runtimeRole.can_execute_current_refund, true);
    assert.equal(runtimeRole.runtime_group_safe, true);
    assert.equal(runtimeRole.ddl_group_safe, true);
    const publicPrivilege = await admin.query<{ public_schema_create: boolean; public_table_write: boolean; public_function_execute: boolean }>(
      `select exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname='public' and a.grantee=0 and a.privilege_type='CREATE') as public_schema_create,
              exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind='S' then 'S' else 'r' end)::"char", c.relowner))) a where n.nspname='public' and c.relkind in ('r','p','S','v','m','f') and a.grantee=0 and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','USAGE')) as public_table_write,
              exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where n.nspname='public' and a.grantee=0 and a.privilege_type='EXECUTE') as public_function_execute`,
    );
    assert.equal(publicPrivilege.rows[0].public_schema_create, false);
    assert.equal(publicPrivilege.rows[0].public_table_write, false);
    assert.equal(publicPrivilege.rows[0].public_function_execute, false);

    let actor = (await admin.query("select id from public.profiles where role = 'admin' and active = true order by created_at limit 1")).rows[0]?.id as string;
    const table = (await admin.query("select id, qr_token_version, qr_token_hash from public.restaurant_tables where active order by created_at limit 1")).rows[0] as { id: string; qr_token_version: number; qr_token_hash: string } | undefined;
    const categoryId = (await admin.query("select id from public.categories where active and deleted_at is null order by display_order limit 1")).rows[0]?.id as string | undefined;
    assert.ok(actor, "seed must create an active administrator");
    assert.ok(table, "seed must create a table");
    assert.ok(categoryId, "seed must create an active category");

    const tracked = (await admin.query(
      `insert into public.products(category_id, name, price_idr, estimated_cost_idr, active, available, stock_tracked, stock_quantity)
       values ($1, $2, 30000, 9000, true, true, true, 0) returning id`, [categoryId, `Integration tracked ${randomUUID()}`],
    )).rows[0].id as string;
    const free = (await admin.query(
      `insert into public.products(category_id, name, price_idr, estimated_cost_idr, active, available, stock_tracked, stock_quantity)
       values ($1, $2, 30000, 9000, true, true, false, 0) returning id`, [categoryId, `Integration free ${randomUUID()}`],
    )).rows[0].id as string;

    await t.test("two database connections serialize opening and closing a shift", async () => {
      const intake = JSON.stringify([{ productId: tracked, quantity: 50 }]);
      const opening = await Promise.allSettled([
        runtime.query("select public.open_cashier_shift($1::uuid, 'integration concurrency', $2::jsonb)", [actor, intake]),
        independentRuntime((client) => client.query("select public.open_cashier_shift($1::uuid, 'integration concurrency', $2::jsonb)", [actor, intake])),
      ]);
      assert.equal(opening.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(opening.filter((result) => result.status === "rejected").length, 1);
      const openRows = await admin.query("select id from public.cashier_shifts where closed_at is null");
      assert.equal(openRows.rowCount, 1);
      const firstShift = openRows.rows[0].id as string;
      const closing = await Promise.allSettled([
        runtime.query("select public.close_cashier_shift($1::uuid, 'integration close')", [actor]),
        independentRuntime((client) => client.query("select public.close_cashier_shift($1::uuid, 'integration close')", [actor])),
      ]);
      assert.equal(closing.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(closing.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await admin.query("select closed_at from public.cashier_shifts where id = $1", [firstShift])).rows[0].closed_at instanceof Date, true);
    });

    currentShiftId = (await runtime.query("select public.open_cashier_shift($1::uuid, 'main integration shift', $2::jsonb)", [actor, JSON.stringify([{ productId: tracked, quantity: 100 }])])).rows[0].open_cashier_shift as string;

    await t.test("cash checkout, QRIS checkout, idempotency replay, and fingerprint conflict", async () => {
      const cash = await checkout({ productId: free, actorId: actor, tableId: table.id, method: "cash" });
      assert.equal(cash.payment_status, "settled");
      assert.equal((await admin.query("select status from public.orders where id = $1", [cash.order_id])).rows[0].status, "paid");

      const sessionHash = await createSession(table.id);
      const idem = randomUUID();
      const fingerprint = hash("same-cart");
      const first = await checkout({ productId: free, sessionHash, key: idem, fingerprint });
      const replay = await checkout({ productId: free, sessionHash, key: idem, fingerprint });
      assert.equal(first.payment_id, replay.payment_id);
      assert.equal(replay.replayed, true);
      await assert.rejects(checkout({ productId: free, sessionHash, key: idem, fingerprint: hash("different-cart") }), /IDEMPOTENCY_KEY_REUSED/);
      assert.equal(first.payment_status, "pending");
      await expire(first.payment_id);
    });

    await t.test("simultaneous reservations and duplicate settlement consume stock once", async () => {
      await admin.query("update public.products set stock_quantity = 1 where id = $1", [tracked]);
      const firstSession = await createSession(table.id);
      const secondSession = await createSession(table.id);
      const attempts = await Promise.allSettled([
        independentRuntime(async (client) => {
          const result = await client.query("select * from public.create_checkout_intent($1::uuid,$2,$3,null,null,'qris'::public.payment_method,$4::jsonb)", [randomUUID(), hash(randomUUID()), firstSession, JSON.stringify(itemFor(tracked))]);
          return result.rows[0] as { payment_id: string; provider_order_id: string };
        }),
        independentRuntime(async (client) => {
          const result = await client.query("select * from public.create_checkout_intent($1::uuid,$2,$3,null,null,'qris'::public.payment_method,$4::jsonb)", [randomUUID(), hash(randomUUID()), secondSession, JSON.stringify(itemFor(tracked))]);
          return result.rows[0] as { payment_id: string; provider_order_id: string };
        }),
      ]);
      assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1, attempts.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason)).join("; "));
      assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
      const winner = attempts.find((result): result is PromiseFulfilledResult<{ payment_id: string; provider_order_id: string }> => result.status === "fulfilled")!.value;
      assert.ok(winner.provider_order_id.length <= 64);
      await settle(winner.payment_id);
      await settle(winner.payment_id);
      assert.equal(Number((await admin.query("select stock_quantity from public.products where id = $1", [tracked])).rows[0].stock_quantity), 0);
      assert.equal(Number((await admin.query("select count(*) from public.inventory_adjustments where product_id = $1 and adjustment_type = 'sale_consumed'", [tracked])).rows[0].count), 1);
      assert.equal((await admin.query("select status from public.inventory_reservations where payment_id = $1", [winner.payment_id])).rows[0].status, "consumed");
    });

    await t.test("provider claims use compare-and-set ownership, recover after timeout, and reject finalize after cancellation", async () => {
      await admin.query("update public.products set stock_quantity = 20 where id = $1", [tracked]);
      const sessionHash = await createSession(table.id);
      const intent = await checkout({ productId: tracked, sessionHash });
      const oldClaim = (await runtime.query("select * from public.claim_payment_provider_create($1::uuid)", [intent.payment_id])).rows[0] as { claimed: boolean; claim_token: string };
      assert.equal(oldClaim.claimed, true);
      await admin.query("update public.payments set provider_creation_claimed_at = timezone('utc', now()) - interval '61 seconds' where id = $1", [intent.payment_id]);
      const newClaim = (await runtime.query("select * from public.claim_payment_provider_create($1::uuid)", [intent.payment_id])).rows[0] as { claimed: boolean; claim_token: string };
      assert.equal(newClaim.claimed, true);
      assert.notEqual(oldClaim.claim_token, newClaim.claim_token);
      assert.equal((await runtime.query("select public.release_payment_provider_create($1::uuid,$2::uuid,'old_worker',false)", [intent.payment_id, oldClaim.claim_token])).rows[0].release_payment_provider_create, false);
      const providerExpiry = new Date(new Date(intent.expires_at!).getTime() - 500).toISOString();
      assert.equal((await runtime.query("select public.finalize_payment_provider_create($1::uuid,$2::uuid,'txn-finalize-stale','old-qr',$3::timestamptz)", [intent.payment_id, oldClaim.claim_token, providerExpiry])).rows[0].finalize_payment_provider_create, false);
      assert.equal((await runtime.query("select public.mark_payment_provider_create_submitted($1::uuid,$2::uuid) as started", [intent.payment_id, newClaim.claim_token])).rows[0].started, true);
      assert.equal((await runtime.query("select public.finalize_payment_provider_create($1::uuid,$2::uuid,'txn-finalize-winner','valid-qris-material',$3::timestamptz)", [intent.payment_id, newClaim.claim_token, providerExpiry])).rows[0].finalize_payment_provider_create, true);
      const deadlines = await admin.query("select expires_at, provider_expires_at from public.payments where id = $1", [intent.payment_id]);
      assert.equal(new Date(deadlines.rows[0].expires_at).toISOString(), providerExpiry);
      assert.equal(new Date(deadlines.rows[0].provider_expires_at).toISOString(), providerExpiry);
      assert.equal(new Date((await admin.query("select expires_at from public.inventory_reservations where payment_id=$1", [intent.payment_id])).rows[0].expires_at).toISOString(), providerExpiry);
      await expire(intent.payment_id);

      const cancelledSession = await createSession(table.id);
      const cancelledIntent = await checkout({ productId: tracked, sessionHash: cancelledSession });
      const claim = (await runtime.query("select * from public.claim_payment_provider_create($1::uuid)", [cancelledIntent.payment_id])).rows[0];
      assert.equal((await runtime.query("select public.mark_payment_provider_create_submitted($1::uuid,$2::uuid) as started", [cancelledIntent.payment_id, claim.claim_token])).rows[0].started, true);
      const cancel = await runtime.query("select * from public.cancel_order($1::uuid,null,$2::uuid)", [cancelledIntent.order_id, actor]);
      assert.equal(cancel.rows[0].cancelled, true);
      assert.equal((await runtime.query("select public.finalize_payment_provider_create($1::uuid,$2::uuid,'txn-after-cancel','must-not-escape',$3::timestamptz)", [cancelledIntent.payment_id, claim.claim_token, cancelledIntent.expires_at])).rows[0].finalize_payment_provider_create, false);
      assert.equal((await admin.query("select qr_string from public.payments where id=$1", [cancelledIntent.payment_id])).rows[0].qr_string, null);

      const timedOutSession = await createSession(table.id);
      const timedOutIntent = await checkout({ productId: tracked, sessionHash: timedOutSession });
      const timedOutClaim = (await runtime.query("select * from public.claim_payment_provider_create($1::uuid)", [timedOutIntent.payment_id])).rows[0] as { claimed: boolean; claim_token: string };
      assert.equal((await runtime.query("select public.mark_payment_provider_create_submitted($1::uuid,$2::uuid) as started", [timedOutIntent.payment_id, timedOutClaim.claim_token])).rows[0].started, true);
      await admin.query("update public.payments set provider_creation_claimed_at=timezone('utc',now())-interval '61 seconds' where id=$1", [timedOutIntent.payment_id]);
      const blockedRetry = (await runtime.query("select * from public.claim_payment_provider_create($1::uuid)", [timedOutIntent.payment_id])).rows[0] as { claimed: boolean };
      assert.equal(blockedRetry.claimed, false, "a timed-out worker that may have called Midtrans must reconcile before another charge request");
      assert.equal((await admin.query("select count(*) from public.provider_reconciliation_alerts where payment_id=$1 and alert_type='provider_create_outcome_unknown' and state='unresolved'", [timedOutIntent.payment_id])).rows[0].count, "1");
      await expire(timedOutIntent.payment_id);
    });

    await t.test("settlement racing cancellation never leaves a cancelled paid order", async () => {
      const sessionHash = await createSession(table.id);
      const intent = await checkout({ productId: tracked, sessionHash });
      const outcomes = await Promise.allSettled([
        independentRuntime((client) => client.query("select * from public.cancel_order($1::uuid,null,$2::uuid)", [intent.order_id, actor])),
        independentRuntime((client) => client.query("select * from public.apply_payment_transition($1::uuid,'settled'::public.payment_status,'settlement','txn-race',0,timezone('utc',now()))", [intent.payment_id])),
      ]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 2, outcomes.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason)).join("; "));
      const finalState = await admin.query("select o.status as order_status,p.status as payment_status,p.orphaned_settlement from public.orders o join public.payments p on p.order_id=o.id where p.id=$1", [intent.payment_id]);
      assert.equal(finalState.rows[0].payment_status, "settled");
      assert.notEqual(finalState.rows[0].order_status, "cancelled");
      const cancelResult = outcomes[0] as PromiseFulfilledResult<{ rows: Array<{ cancelled: boolean }> }>;
      if (cancelResult.value.rows[0].cancelled) assert.equal(finalState.rows[0].orphaned_settlement, true);
    });

    await t.test("expired reservations release, late settlement is visible, and acceptance is stock-safe and audited", async () => {
      const sessionHash = await createSession(table.id);
      const intent = await checkout({ productId: tracked, sessionHash });
      await expire(intent.payment_id);
      const reservation = await admin.query("select status from public.inventory_reservations where payment_id = $1", [intent.payment_id]);
      assert.equal(reservation.rows[0].status, "expired");
      await settle(intent.payment_id);
      const orphan = await admin.query("select status, orphaned_settlement from public.payments where id=$1", [intent.payment_id]);
      assert.equal(orphan.rows[0].status, "settled");
      assert.equal(orphan.rows[0].orphaned_settlement, true);
      await admin.query("update public.products set stock_quantity=0 where id=$1", [tracked]);
      await assert.rejects(runtime.query("select * from public.reconcile_orphaned_settlement($1::uuid,'accept',$2::uuid,'cannot safely fulfill')", [intent.payment_id, actor]), /ORPHANED_SETTLEMENT_STOCK_UNAVAILABLE/);
      await admin.query("update public.products set stock_quantity=1 where id=$1", [tracked]);
      const accepted = await runtime.query("select * from public.reconcile_orphaned_settlement($1::uuid,'accept',$2::uuid,'stock verified and accepted')", [intent.payment_id, actor]);
      assert.equal(accepted.rows[0].resolved, true);
      assert.equal((await admin.query("select orphaned_settlement from public.payments where id=$1", [intent.payment_id])).rows[0].orphaned_settlement, false);
      assert.equal((await admin.query("select count(*) from public.audit_logs where action='orphaned_settlement_accepted' and entity_id=$1", [intent.payment_id])).rows[0].count, "1");
    });

    await t.test("a fully refunded orphan remains visible until an audited recovery action closes it", async () => {
      const intent = await checkout({ productId: free, sessionHash: await createSession(table.id) });
      await runtime.query("select * from public.cancel_order($1::uuid,null,$2::uuid)", [intent.order_id, actor]);
      await settle(intent.payment_id);
      assert.equal((await admin.query("select orphaned_settlement from public.payments where id=$1", [intent.payment_id])).rows[0].orphaned_settlement, true);
      const idempotencyKey = randomUUID();
      const claim = (await runtime.query("select * from public.claim_payment_refund($1::uuid,$2,'refund orphaned settlement',$3::uuid,$4::uuid)", [intent.payment_id, intent.amount_idr, idempotencyKey, actor])).rows[0];
      await runtime.query("select public.set_refund_attempt_state($1::uuid,$2::uuid,'submitted',null,'{}'::jsonb)", [claim.attempt_id, claim.claim_token]);
      await runtime.query("select * from public.finalize_payment_refund_attempt($1::uuid,$2::uuid,$3::uuid)", [claim.attempt_id, claim.claim_token, actor]);
      const refunded = await admin.query("select status,refunded_amount_idr,amount_idr,orphaned_settlement from public.payments where id=$1", [intent.payment_id]);
      assert.equal(refunded.rows[0].status, "refunded");
      assert.equal(refunded.rows[0].orphaned_settlement, true, "a crash before the reconciliation closure must remain visible");
      await runtime.query("select public.record_admin_reconciliation_request($1::uuid,'complete_orphaned_refund',$2::uuid,null)", [actor, intent.payment_id]);
      await runtime.query("select public.complete_orphaned_settlement_refund($1::uuid,$2::uuid,'provider refund confirmed and settlement closed')", [intent.payment_id, actor]);
      assert.equal((await admin.query("select orphaned_settlement from public.payments where id=$1", [intent.payment_id])).rows[0].orphaned_settlement, false);
      assert.equal((await admin.query("select count(*) from public.audit_logs where action='orphaned_settlement_refunded' and entity_id=$1", [intent.payment_id])).rows[0].count, "1");
    });

    await t.test("realistic Midtrans settlement is signature-checked, stored once, and applied once", async () => {
      await admin.query("update public.products set stock_quantity=10 where id=$1", [tracked]);
      const sessionHash = await createSession(table.id);
      const intent = await checkout({ productId: tracked, sessionHash });
      const key = "integration-only-midtrans-server-key";
      const event: Record<string, unknown> & { order_id: string; status_code: string; gross_amount: string; transaction_status: string; transaction_id: string; signature_key: string } = {
        transaction_time: "2026-10-04 12:30:00",
        settlement_time: "2026-10-04 12:30:05",
        transaction_status: "settlement",
        transaction_id: `midtrans-${randomUUID()}`,
        status_code: "200",
        signature_key: "",
        payment_type: "qris",
        order_id: intent.provider_order_id,
        gross_amount: "30000.00",
        currency: "IDR",
        acquirer: "gopay",
        custom_provider_field: { retry: 2, origin: "webhook" },
      };
      event.signature_key = midtransSignature(event.order_id, event.status_code, event.gross_amount, key);
      const parsed = midtransWebhookSchema.safeParse(event);
      assert.equal(parsed.success, true);
      assert.equal(verifyMidtransSignature(parsed.data!, key), true);
      assert.equal(verifyMidtransSignature({ ...parsed.data!, gross_amount: "30000.01" }, key), false);
      const providerEventKey = midtransEventIdentity(parsed.data!);
      await runtime.query("insert into public.payment_events(payment_id,provider_event_key,provider_transaction_id,event_type,payload,verified) values($1,$2,$3,$4,$5::jsonb,true)", [intent.payment_id, providerEventKey, event.transaction_id, event.transaction_status, JSON.stringify(parsed.data)]);
      await assert.rejects(runtime.query("insert into public.payment_events(payment_id,provider_event_key,provider_transaction_id,event_type,payload,verified) values($1,$2,$3,$4,$5::jsonb,true)", [intent.payment_id, providerEventKey, event.transaction_id, event.transaction_status, JSON.stringify(parsed.data)]), (error: unknown) => (error as { code?: string }).code === "23505");
      await settle(intent.payment_id, "2026-10-04T05:30:05.000Z");
      await settle(intent.payment_id, "2026-10-04T05:30:05.000Z");
      const stored = await admin.query("select payload->>'gross_amount' as gross_amount,payload->'custom_provider_field' as custom_provider_field,verified from public.payment_events where provider_event_key=$1", [providerEventKey]);
      assert.equal(stored.rows[0].gross_amount, "30000.00");
      assert.deepEqual(stored.rows[0].custom_provider_field, { retry: 2, origin: "webhook" });
      assert.equal(stored.rows[0].verified, true);
      assert.equal(Number((await admin.query("select count(*) from public.inventory_adjustments where product_id=$1 and adjustment_type='sale_consumed'", [tracked])).rows[0].count) >= 2, true);
    });

    await t.test("database money bounds return MONEY_LIMIT above the ceiling and accept one IDR below it", async () => {
      const below = (await admin.query("insert into public.products(category_id,name,price_idr,estimated_cost_idr,stock_tracked) values($1,$2,1999999999,0,false) returning id", [categoryId, `Money below ${randomUUID()}`])).rows[0].id as string;
      const above = (await admin.query("insert into public.products(category_id,name,price_idr,estimated_cost_idr,stock_tracked) values($1,$2,2000000001,0,false) returning id", [categoryId, `Money above ${randomUUID()}`])).rows[0].id as string;
      const multiplication = (await admin.query("insert into public.products(category_id,name,price_idr,estimated_cost_idr,stock_tracked) values($1,$2,100000000,0,false) returning id", [categoryId, `Money multiplication ${randomUUID()}`])).rows[0].id as string;
      const accepted = await checkout({ productId: below, actorId: actor, tableId: table.id, method: "cash" });
      assert.equal(accepted.amount_idr, 1_999_999_999);
      await assert.rejects(checkout({ productId: above, actorId: actor, tableId: table.id, method: "cash" }), /MONEY_LIMIT/);
      await assert.rejects(checkout({ productId: multiplication, actorId: actor, tableId: table.id, method: "cash", quantity: 21 }), /MONEY_LIMIT/);
      await assert.rejects(checkout({ productId: multiplication, actorId: actor, tableId: table.id, method: "cash", quantity: 2_147_483_648 }), /INVALID_QUANTITY/);
    });

    await t.test("durable refund workflow recovers a provider success after a simulated process crash", async () => {
      await admin.query("update public.products set stock_quantity=30 where id=$1", [tracked]);
      const sessionHash = await createSession(table.id);
      const intent = await checkout({ productId: free, sessionHash });
      await settle(intent.payment_id);
      const idempotencyKey = randomUUID();
      const refundKey = `refund-${hash(`${intent.payment_id}:${idempotencyKey}`).slice(0, 40)}`;
      let statusChecks = 0;
      let providerRefundCalls = 0;
      let requestedTransactionId = "";
      const provider: PaymentProvider = {
        async createPayment() { throw new Error("unused provider operation"); },
        async expirePayment() { return { outcome: "confirmed_expired", statusCode: 200 }; },
        async getPaymentStatus() {
          statusChecks += 1;
          return {
            state: "settled", providerStatus: "settlement", providerTransactionId: "txn-refund-test",
            refunds: statusChecks === 1 ? [] : [{ refundKey, amountIdr: 10_000 }],
          };
        },
        async refundPayment(transactionId, amountIdr, key) {
          requestedTransactionId = transactionId;
          assert.equal(amountIdr, 10_000);
          assert.equal(key, refundKey);
          providerRefundCalls += 1;
          return { submitted: true, duplicate: false };
        },
      };
      const queryForWorkflow = (async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => runtime.query<Row>(sql, values as never[])) as RefundQuery;
      const input = { paymentId: intent.payment_id, amountIdr: 10_000, reason: "provider accepted before process crash", idempotencyKey, actorId: actor };
      const crashingQuery = (async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => {
        if (sql.includes("set_refund_attempt_state")) throw new Error("simulated_process_crash_after_provider_success");
        return runtime.query<Row>(sql, values as never[]);
      }) as RefundQuery;
      await assert.rejects(processRefundAttemptCore(input, { query: crashingQuery, provider }), /simulated_process_crash_after_provider_success/);
      assert.equal(providerRefundCalls, 1);
      assert.ok(requestedTransactionId.startsWith("txn-"));
      const attempt = (await admin.query("select id, refund_key, state, claimed_at from public.refund_attempts where payment_id=$1 and idempotency_key=$2", [intent.payment_id, idempotencyKey])).rows[0] as { id: string; refund_key: string; state: string };
      assert.equal(attempt.refund_key, refundKey);
      assert.equal(attempt.state, "claimed");
      await admin.query("update public.refund_attempts set claimed_at=timezone('utc',now())-interval '61 seconds' where id=$1", [attempt.id]);

      const recovered = await processRefundAttemptCore(input, { query: queryForWorkflow, provider });
      assert.equal(recovered.ok, true);
      if (recovered.ok) assert.equal(recovered.paymentStatus, "partially_refunded");
      assert.equal(providerRefundCalls, 1, "recovery reads the existing provider refund and must not submit it again");
      assert.equal((await admin.query("select count(*) from public.payment_refunds where refund_key=$1", [refundKey])).rows[0].count, "1");
      assert.equal((await admin.query("select refunded_amount_idr from public.payments where id=$1", [intent.payment_id])).rows[0].refunded_amount_idr, 10_000);

      const webhookMetadata = { refundKeys: [refundKey], amountIdr: 10000 };
      await runtime.query("select public.mark_provider_refund_notification($1::uuid,'partial_refund',$2::jsonb)", [intent.payment_id, JSON.stringify(webhookMetadata)]);
      await runtime.query("select public.mark_provider_refund_notification($1::uuid,'partial_refund',$2::jsonb)", [intent.payment_id, JSON.stringify(webhookMetadata)]);
      assert.equal((await admin.query("select refunded_amount_idr from public.payments where id=$1", [intent.payment_id])).rows[0].refunded_amount_idr, 10000);
      assert.equal((await admin.query("select count(*) from public.payment_refunds where payment_id=$1", [intent.payment_id])).rows[0].count, "1");
      assert.equal((await admin.query("select count(*) from public.provider_reconciliation_alerts where payment_id=$1 and alert_type='provider_refund_without_local_attempt'", [intent.payment_id])).rows[0].count, "0", "duplicate notifications for a confirmed refund must not create false orphan alerts");
    });

    await t.test("provider-confirmed refund without a local attempt is durably prepared, reconciled, and audited", async () => {
      const intent = await checkout({ productId: free, sessionHash: await createSession(table.id) });
      await settle(intent.payment_id);
      const refundKey = `provider-import-${randomUUID()}`;
      const unknownNotification = { refundKeys: [refundKey], refundAmount: "5000.00" };
      await runtime.query("select public.mark_provider_refund_notification($1::uuid,'partial_refund',$2::jsonb)", [intent.payment_id, JSON.stringify(unknownNotification)]);
      const alert = (await admin.query("select id from public.provider_reconciliation_alerts where payment_id=$1 and alert_type='provider_refund_without_local_attempt' and state='unresolved'", [intent.payment_id])).rows[0];
      assert.ok(alert);
      const prepared = (await runtime.query("select * from public.prepare_provider_confirmed_refund_attempt($1::uuid,$2,5000,'provider status confirmed refund',$3::uuid)", [intent.payment_id, refundKey, actor])).rows[0] as { attempt_id: string; idempotency_key: string };
      const workflowQuery = (async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => runtime.query<Row>(sql, values as never[])) as RefundQuery;
      const provider: PaymentProvider = {
        async createPayment() { throw new Error("unused provider operation"); },
        async expirePayment() { return { outcome: "confirmed_expired", statusCode: 200 }; },
        async getPaymentStatus() { return { state: "partially_refunded", providerStatus: "partial_refund", refunds: [{ refundKey, amountIdr: 5_000 }] }; },
        async refundPayment() { throw new Error("reconciliation must not submit a new refund"); },
      };
      const result = await reconcileRefundAttemptCore(prepared.attempt_id, actor, { query: workflowQuery, provider });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.refundedAmountIdr, 5_000);
      assert.equal((await admin.query("select refunded_amount_idr from public.payments where id=$1", [intent.payment_id])).rows[0].refunded_amount_idr, 5_000);
      assert.equal((await admin.query("select count(*) from public.payment_refunds where refund_key=$1", [refundKey])).rows[0].count, "1");
      await runtime.query("select public.resolve_provider_reconciliation_alert($1::uuid,$2::uuid,$3)", [alert.id, actor, "Provider status verified and local refund accounted"]);
      assert.equal((await admin.query("select count(*) from public.audit_logs where action='provider_reconciliation_resolved' and entity_id=$1", [alert.id])).rows[0].count, "1");
      assert.ok(prepared.idempotency_key);
    });

    await t.test("partial followed by remaining refund and concurrent refund claims cannot over-refund", async () => {
      const sessionHash = await createSession(table.id);
      const partialPayment = await checkout({ productId: free, sessionHash });
      await settle(partialPayment.payment_id);
      for (const [amount, reason] of [[10000, "partial refund"], [20000, "remaining refund"]] as const) {
        const key = randomUUID();
        const claim = (await runtime.query("select * from public.claim_payment_refund($1::uuid,$2,$3,$4::uuid,$5::uuid)", [partialPayment.payment_id, amount, reason, key, actor])).rows[0];
        const final = await runtime.query("select * from public.finalize_payment_refund_attempt($1::uuid,$2::uuid,$3::uuid)", [claim.attempt_id, claim.claim_token, actor]);
        assert.ok(final.rows[0]);
      }
      assert.equal((await admin.query("select status,refunded_amount_idr from public.payments where id=$1", [partialPayment.payment_id])).rows[0].status, "refunded");
      assert.equal((await admin.query("select refunded_amount_idr from public.payments where id=$1", [partialPayment.payment_id])).rows[0].refunded_amount_idr, 30000);
      assert.equal((await admin.query("select count(*) from public.payment_refunds where payment_id=$1", [partialPayment.payment_id])).rows[0].count, "2");

      const concurrentPayment = await checkout({ productId: free, sessionHash: await createSession(table.id) });
      await settle(concurrentPayment.payment_id);
      const claims = await Promise.allSettled([
        independentRuntime((client) => client.query("select * from public.claim_payment_refund($1::uuid,20000,'concurrent A',$2::uuid,$3::uuid)", [concurrentPayment.payment_id, randomUUID(), actor])),
        independentRuntime((client) => client.query("select * from public.claim_payment_refund($1::uuid,15000,'concurrent B',$2::uuid,$3::uuid)", [concurrentPayment.payment_id, randomUUID(), actor])),
      ]);
      assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
      assert.match(String((claims.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /INVALID_REFUND_AMOUNT/);
    });

    await t.test("modifier groups have one owner and active products remain satisfiable", async () => {
      const modifierProduct = (await admin.query(
        `insert into public.products(category_id,name,price_idr,estimated_cost_idr,active,available,stock_tracked,stock_quantity)
         values($1,$2,30000,9000,true,true,false,0) returning id`, [categoryId, `Integration modifier ${randomUUID()}`],
      )).rows[0].id as string;
      const group = (await runtime.query("select public.create_modifier_group('variant','Integration required','single',true,1,1,1,$1::uuid) as id", [actor])).rows[0];
      const option = (await runtime.query("select public.create_modifier_option('variant',$1::uuid,'Only choice',0,0,true,1,$2::uuid) as id", [group.id, actor])).rows[0];
      assert.equal((await runtime.query("select public.set_product_modifier_groups($1::uuid,$2::uuid[],'{}'::uuid[],$3::uuid)", [modifierProduct, [group.id], actor])).rows[0].set_product_modifier_groups, true);
      await assert.rejects(runtime.query("select public.set_product_modifier_groups($1::uuid,$2::uuid[],'{}'::uuid[],$3::uuid)", [tracked, [group.id], actor]), /MODIFIER_GROUP_IN_USE/);
      await assert.rejects(runtime.query("select public.update_modifier_option('variant',$1::uuid,null,null,null,false,null,$2::uuid)", [option.id, actor]), /MODIFIER_GROUP_UNSATISFIABLE/);
      await assert.rejects(runtime.query("select public.update_modifier_group('variant',$1::uuid,null,'multiple',null,2,2,null,null,$2::uuid)", [group.id, actor]), /MODIFIER_GROUP_UNSATISFIABLE/);

      const addonProduct = (await admin.query(
        `insert into public.products(category_id,name,price_idr,estimated_cost_idr,active,available,stock_tracked,stock_quantity)
         values($1,$2,30000,9000,true,true,false,0) returning id`, [categoryId, `Integration repeated add-on ${randomUUID()}`],
      )).rows[0].id as string;
      const addonGroup = (await runtime.query("select public.create_modifier_group('addon','Repeatable topping','multiple',false,0,3,1,$1::uuid) as id", [actor])).rows[0].id as string;
      const addonOption = (await runtime.query("select public.create_modifier_option('addon',$1::uuid,'Extra topping',2000,500,true,1,$2::uuid) as id", [addonGroup, actor])).rows[0].id as string;
      await runtime.query("select public.set_product_modifier_groups($1::uuid,'{}'::uuid[],$2::uuid[],$3::uuid)", [addonProduct, [addonGroup], actor]);
      const addOnOrder = await checkout({ productId: addonProduct, sessionHash: await createSession(table.id), addonOptionIds: [addonOption, addonOption] });
      assert.equal(addOnOrder.amount_idr, 34_000);
      assert.equal((await admin.query("select count(*) from public.order_item_modifiers where order_item_id in (select id from public.order_items where order_id=$1) and modifier_type='addon'", [addOnOrder.order_id])).rows[0].count, "2");
      await expire(addOnOrder.payment_id);
    });

    await t.test("table/general QR rotation invalidates existing customer sessions", async () => {
      const oldTableHash = table.qr_token_hash;
      const tableSession = await createSession(table.id, { tableQrVersion: table.qr_token_version, sourceTableId: table.id, sourceTableQrVersion: table.qr_token_version });
      await runtime.query("select public.rotate_table_qr($1::uuid,$2,$3::uuid)", [table.id, hash(randomBytes(32).toString("hex")), actor]);
      await assert.rejects(checkout({ productId: free, sessionHash: tableSession }), /TABLE_NOT_AVAILABLE/);

      const qr = (await runtime.query("select * from public.create_general_qr($1,$2,$3::uuid)", [`Integration QR ${randomUUID()}`, hash(randomBytes(32).toString("hex")), actor])).rows[0];
      const qrRow = (await admin.query("select id,token_version from public.ordering_qr_codes where id=$1", [qr.id])).rows[0];
      const generalSession = await createSession(table.id, { orderingQrId: qrRow.id, orderingQrVersion: qrRow.token_version });
      await runtime.query("select public.rotate_general_qr($1::uuid,$2,$3::uuid)", [qrRow.id, hash(randomBytes(32).toString("hex")), actor]);
      await assert.rejects(checkout({ productId: free, sessionHash: generalSession }), /QR_NOT_AVAILABLE/);
      assert.notEqual(oldTableHash, (await admin.query("select qr_token_hash from public.restaurant_tables where id=$1", [table.id])).rows[0].qr_token_hash);
    });

    await t.test("staff session caps, revocation, password reset, and self-admin protection hold", async () => {
      const email = `integration-${randomUUID()}@example.test`;
      const profile = (await runtime.query("select * from public.create_staff_account($1,$2,$3,'operator'::public.staff_role,$4::uuid)", [email, passwordHash(), "Integration Operator", actor])).rows[0];
      for (let index = 0; index < 6; index += 1) {
        await runtime.query("select public.create_staff_session($1::uuid,$2,timezone('utc',now())+interval '1 hour')", [profile.id, hash(randomUUID())]);
      }
      assert.equal(Number((await admin.query("select count(*) from public.staff_sessions where staff_user_id=$1 and revoked_at is null", [profile.id])).rows[0].count), 5);
      assert.equal(Number((await runtime.query("select public.revoke_staff_sessions($1::uuid,$2::uuid)", [profile.id, actor])).rows[0].revoke_staff_sessions), 5);
      const tokenHash = hash(randomUUID());
      await runtime.query("select public.create_staff_session($1::uuid,$2,timezone('utc',now())+interval '1 hour')", [profile.id, tokenHash]);
      await runtime.query("select public.change_staff_password($1::uuid,$2,$3::uuid,null)", [profile.id, passwordHash(), actor]);
      assert.equal((await admin.query("select revoked_at is not null as revoked from public.staff_sessions where token_hash=$1", [tokenHash])).rows[0].revoked, true);
      await assert.rejects(runtime.query("select public.update_staff_profile($1::uuid,false,'operator'::public.staff_role,$1::uuid)", [actor]), /SELF_ADMIN_PROTECTION/);

      const secondAdmin = (await runtime.query("select * from public.create_staff_account($1,$2,$3,'admin'::public.staff_role,$4::uuid)", [`admin-race-${randomUUID()}@example.test`, passwordHash(), "Concurrent Admin", actor])).rows[0].id as string;
      const adminRace = await Promise.allSettled([
        independentRuntime((client) => client.query("select public.update_staff_profile($1::uuid,false,null::public.staff_role,$2::uuid)", [actor, secondAdmin])),
        independentRuntime((client) => client.query("select public.update_staff_profile($1::uuid,false,null::public.staff_role,$2::uuid)", [secondAdmin, actor])),
      ]);
      assert.equal(adminRace.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(adminRace.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await admin.query("select count(*) from public.profiles where role='admin' and active=true")).rows[0].count, "1");
      actor = (await admin.query("select id from public.profiles where role='admin' and active=true limit 1")).rows[0].id as string;
    });

    await t.test("shift refunds are scoped in SQL and a historical pending payment cannot block another shift close", async () => {
      const reportDate = "2027-10-04";
      const firstSession = await createSession(table.id);
      const firstOrder = await checkout({ productId: free, sessionHash: firstSession });
      await settle(firstOrder.payment_id, "2027-10-04T05:00:00.000Z");
      const firstShift = currentShiftId!;
      await runtime.query("select public.close_cashier_shift($1::uuid,'close report shift A')", [actor]);

      currentShiftId = (await runtime.query("select public.open_cashier_shift($1::uuid,'report shift B',$2::jsonb)", [actor, JSON.stringify([{ productId: tracked, quantity: 10 }])])).rows[0].open_cashier_shift as string;
      const secondSession = await createSession(table.id);
      const secondOrder = await checkout({ productId: free, sessionHash: secondSession });
      await settle(secondOrder.payment_id, "2027-10-04T06:00:00.000Z");
      await admin.query("insert into public.payment_refunds(payment_id,amount_idr,refund_key,reason,actor_id,processed_at) values($1,1000,$2,'shift A refund',$3,'2027-10-04T07:00:00Z')", [firstOrder.payment_id, `shiftA-${randomUUID()}`, actor]);
      await admin.query("insert into public.payment_refunds(payment_id,amount_idr,refund_key,reason,actor_id,processed_at) values($1,2000,$2,'shift B refund',$3,'2027-10-04T08:00:00Z')", [secondOrder.payment_id, `shiftB-${randomUUID()}`, actor]);

      const reportPool = new pg.Pool({ connectionString: runtimeUrl });
      try {
        const reportQuery = async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => reportPool.query<Row>(sql, values);
        const reportA = await getReport(reportDate, reportDate, firstShift, reportQuery);
        const allShifts = await getReport(reportDate, reportDate, undefined, reportQuery);
        assert.equal(reportA.refundsIdr, 1000);
        assert.equal(allShifts.refundsIdr, 3000);
      } finally {
        await reportPool.end();
      }

      const oldShiftId = (await admin.query("select id from public.cashier_shifts where closed_at is not null and id <> $1 order by opened_at limit 1", [currentShiftId])).rows[0]?.id as string | undefined;
      assert.ok(oldShiftId);
      const historicalPending = await checkout({ productId: free, sessionHash: await createSession(table.id) });
      await admin.query("update public.orders set shift_id=$1 where id=$2", [oldShiftId, historicalPending.order_id]);
      await runtime.query("select public.close_cashier_shift($1::uuid,'historical pending is out of scope')", [actor]);
      currentShiftId = null;
      await expire(historicalPending.payment_id);
    });

    await t.test("cleanup removes expired session and stale rate-limit rows", async () => {
      const staleSessionHash = hash(randomUUID());
      await admin.query("insert into public.customer_sessions(access_token_hash,order_type,table_id,expires_at) values($1,'dine_in',$2,timezone('utc',now())-interval '9 days')", [staleSessionHash, table.id]);
      const staleBucket = `test:${hash(randomUUID())}`;
      await admin.query("insert into public.rate_limit_buckets(bucket_key,window_started_at,request_count,updated_at) values($1,timezone('utc',now())-interval '8 days',1,timezone('utc',now())-interval '8 days')", [staleBucket]);
      await runtime.query("select * from public.cleanup_stale_sessions_and_rate_limits()");
      assert.equal((await admin.query("select count(*) from public.customer_sessions where access_token_hash=$1", [staleSessionHash])).rows[0].count, "0");
      assert.equal((await admin.query("select count(*) from public.rate_limit_buckets where bucket_key=$1", [staleBucket])).rows[0].count, "0");
    });

    await t.test("rate limits share a bounded NAT bucket while isolating session and login identities", async () => {
      const buckets = [
        rateLimitKey("checkout:network", "198.51.100.88"),
        rateLimitKey("checkout:identity", `session-${randomUUID()}`),
        rateLimitKey("checkout:identity", `session-${randomUUID()}`),
        rateLimitKey("staff-login-account", `one-${randomUUID()}@example.test`),
        rateLimitKey("staff-login-account", `two-${randomUUID()}@example.test`),
      ];
      const consume = async (bucket: string, limit: number) => (await runtime.query<{ consume_rate_limit: boolean }>(
        "select public.consume_rate_limit($1,$2,300) as consume_rate_limit", [bucket, limit],
      )).rows[0].consume_rate_limit;
      try {
        assert.equal(await consume(buckets[0], 2), true);
        assert.equal(await consume(buckets[1], 1), true);
        assert.equal(await consume(buckets[0], 2), true, "a second customer behind the same NAT gets the shared network allowance");
        assert.equal(await consume(buckets[2], 1), true, "a different customer has an independent session bucket");
        assert.equal(await consume(buckets[0], 2), false, "the shared network bucket still bounds aggregate traffic");
        for (let index = 0; index < 8; index += 1) assert.equal(await consume(buckets[3], 8), true);
        assert.equal(await consume(buckets[3], 8), false, "login throttling remains account-specific");
        assert.equal(await consume(buckets[4], 8), true, "a different login account is not blocked by another account's failures");
      } finally {
        await admin.query("delete from public.rate_limit_buckets where bucket_key = any($1::text[])", [buckets]);
      }
    });

    await t.test("live QRIS reservation capacity is enforced atomically across connections", async () => {
      currentShiftId = (await runtime.query(
        "select public.open_cashier_shift($1::uuid,'capacity test shift',$2::jsonb) as id",
        [actor, JSON.stringify([{ productId: tracked, quantity: 50 }])],
      )).rows[0].id as string;
      const prefix = `cp${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const removeFixtures = async () => {
        await admin.query("delete from public.inventory_reservation_items where reservation_id in (select id from public.inventory_reservations where order_id in (select id from public.orders where idempotency_key like $1 || '-%'))", [prefix]);
        await admin.query("delete from public.inventory_reservations where order_id in (select id from public.orders where idempotency_key like $1 || '-%')", [prefix]);
        await admin.query("delete from public.payments where provider_order_id like $1 || '-%'", [prefix]);
        await admin.query("delete from public.orders where idempotency_key like $1 || '-%'", [prefix]);
      };
      try {
        await admin.query(
           `insert into public.orders(order_number,idempotency_key,order_type,status,subtotal_idr,total_idr)
           select $1 || '-' || number, $1 || '-' || number, 'dine_in','awaiting_payment',1,1
           from generate_series(1,999) as generated(number)`, [prefix],
        );
        await admin.query(
          `insert into public.payments(order_id,method,status,amount_idr,provider_order_id,expires_at)
           select o.id,'qris','pending',1,$1 || '-' || o.id::text,timezone('utc',now())+interval '15 minutes'
           from public.orders o where o.idempotency_key like $1 || '-%'`, [prefix],
        );
        await admin.query(
          `insert into public.inventory_reservations(order_id,payment_id,status,expires_at)
           select p.order_id,p.id,'reserved',p.expires_at from public.payments p
           where p.provider_order_id like $1 || '-%'`, [prefix],
        );
        const extraOrders = await admin.query<{ id: string; idempotency_key: string }>(
          `insert into public.orders(order_number,idempotency_key,order_type,status,subtotal_idr,total_idr)
           values ($1,$1,'dine_in','awaiting_payment',1,1),($2,$2,'dine_in','awaiting_payment',1,1)
           returning id,idempotency_key`, [`${prefix}-race-a`, `${prefix}-race-b`],
        );
        const extraPayments = await Promise.all(extraOrders.rows.map(async (order) => {
          const result = await admin.query<{ id: string; order_id: string; expires_at: Date }>(
            `insert into public.payments(order_id,method,status,amount_idr,provider_order_id,expires_at)
             values ($1,'qris','pending',1,$2,timezone('utc',now())+interval '15 minutes') returning id,order_id,expires_at`,
            [order.id, `${prefix}-${order.id}`],
          );
          return result.rows[0];
        }));
        const attempts = await Promise.allSettled(extraPayments.map((payment) => withClient(adminUrl!, (client) => client.query(
          "insert into public.inventory_reservations(order_id,payment_id,status,expires_at) values($1,$2,'reserved',$3)",
          [payment.order_id, payment.id, payment.expires_at],
        ))));
        assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
        const rejected = attempts.find((result) => result.status === "rejected") as PromiseRejectedResult;
        assert.match(String(rejected.reason), /QR_RESERVATION_CAPACITY/);
        assert.equal((await admin.query(
          `select count(*) from public.inventory_reservations ir join public.payments p on p.id=ir.payment_id
           where ir.status='reserved' and ir.expires_at>timezone('utc',now()) and p.status='pending' and p.method='qris' and p.provider_order_id like $1 || '-%'`,
          [prefix],
        )).rows[0].count, "1000");
      } finally {
        await removeFixtures();
      }
    });
  } finally {
    if (currentShiftId) {
      await runtime.query("select public.close_cashier_shift($1::uuid,'integration cleanup')", [(await admin.query("select id from public.profiles where role='admin' and active=true order by created_at limit 1")).rows[0]?.id]).catch(() => undefined);
    }
    await runtime.end();
    await admin.end();
  }
});
