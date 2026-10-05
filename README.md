# Tempat Taichan POS

Operational POS and QR self-ordering application for one Tempat Taichan branch. It runs on Next.js 16, PostgreSQL 16, and Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (all versions meet Next.js 16 and the pinned pnpm 12 installation requirements). pnpm 12.9.1 and `pnpm-lock.yaml` are the authoritative package manager and lockfile; use `pnpm ci` for clean deployments and CI installs.

## Local development

The local database is a PostgreSQL 16 container defined in `compose.yaml`. It listens on host port `55432` by default. The migration and seed scripts load `.env` and `.env.local`, with shell-provided variables taking precedence.

```bash
pnpm ci
cp .env.example .env.local
pnpm run db:up
pnpm run db:migrate
ADMIN_EMAIL=admin@baraburn.my.id ADMIN_PASSWORD='choose-a-local-password-with-at-least-12-characters' pnpm run db:seed
pnpm run dev
```

Local defaults are intentionally convenient for development only. Production configuration is validated on server startup and does not fall back to local credentials.
Use `pnpm dev` with the local `.env.local`. `pnpm start` runs in production mode, so it rejects the local development database credentials and requires the complete production configuration below.

## Runtime configuration

Set these variables in the server environment, never in `NEXT_PUBLIC_*` variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | The single database login for application traffic, production migrations, and seed jobs. It must be a non-superuser member of both `postaichan_runtime` and `postaichan_ddl`, and must not directly own application objects. |
| `DATABASE_POOL_MAX` | Positive pool size from 1 to 40. Choose it with the database connection limit in mind. |
| `APP_ORIGIN` | Absolute site origin only, such as `https://orders.example.com`; production requires HTTPS. |
| `MIDTRANS_SERVER_KEY` | Server-side Midtrans key for the selected environment. |
| `MIDTRANS_IS_PRODUCTION` | Explicit `true` or `false`; it must match the key and Midtrans endpoint. |
| `CLIENT_IP_STRATEGY` | Explicitly choose `trusted_header`, `trusted_proxy`, or `none`. Production deployments should use a trusted ingress strategy. |
| `TRUSTED_CLIENT_IP_HEADER` | Required for `trusted_header`. Use a single-address header that the ingress overwrites. |
| `TRUSTED_PROXY_HOPS` | Required for `trusted_proxy`; count the trusted proxies that append to `X-Forwarded-For`. |
| `REQUIRE_ORDERING_QR` | Explicit production policy. `true` requires a valid opaque table/general QR token. `false` deliberately permits open walk-in sessions. |
| `DATABASE_DDL_ROLE` | Must be `postaichan_ddl` for production migrations and seed tasks. |

`ALLOW_DEV_STAFF_BYPASS=true` is accepted only when `NODE_ENV=development`; production and staging startup reject it. Configuration errors name the setting but never print its value.

For `CLIENT_IP_STRATEGY=trusted_header`, the ingress must remove any client-supplied copy of the configured header, write the address it observed, and prevent direct public access to the application. For `trusted_proxy`, the application selects the address at the configured trusted hop count from the ingress-managed `X-Forwarded-For` chain. Do not enable either strategy while users can bypass the ingress. With no reliable source the app uses a generous shared safety bucket plus session, QR/table, and global controls; it does not put everyone in the small per-user bucket. Login also has an independent account bucket.

With `REQUIRE_ORDERING_QR=true`, table and general ordering routes require opaque QR tokens and the public table API omits internal table UUIDs. With it set to `false`, public walk-in ordering is intentionally enabled and can reserve tracked stock before payment. Network, session, QR/table, and global checkout limits apply, and the database atomically caps live pending QRIS reservations at 1,000 across all networks. Tracked inventory is also reserved against available stock. Decide this policy before opening public traffic.

## Database roles and migrations

Migrations 001–027 are historical and stay unchanged. New production fixes are additive migrations. CI starts with an empty PostgreSQL 16 database and applies the entire chain in numeric order.

Use separate privilege groups but a single production login:

- `postaichan_ddl` is a non-login owner role for the `public` schema and application database objects. Migration DDL runs with `SET ROLE postaichan_ddl`.
- `postaichan_runtime` is a non-login privilege group with the runtime read access, narrow direct writes, and RPC execute allowlist.
- The one login in `DATABASE_URL` must be a non-superuser member of both groups. It must not directly own application tables, functions, or the `public` schema; those objects stay owned by `postaichan_ddl`.

Provision the login through the database provider or secret manager; do not put passwords in migration SQL. As a database owner, run this idempotent role setup, substituting the actual login and database role identifiers below:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postaichan_ddl') THEN
    CREATE ROLE postaichan_ddl NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postaichan_runtime') THEN
    CREATE ROLE postaichan_runtime NOLOGIN;
  END IF;
END $$;
GRANT postaichan_runtime TO application_login;
GRANT postaichan_ddl TO application_login;
GRANT CREATE ON DATABASE application_database TO postaichan_ddl;
ALTER SCHEMA public OWNER TO postaichan_ddl;
```

If a Vercel deployment fails at the migration preflight with PostgreSQL error `42704` / `regrolein`, the production database is missing `postaichan_ddl`. Starting the local Docker database with `pnpm db:up` does not provision the hosted database. In the database provider's SQL console, connect as the database owner to the database used by Vercel's production `DATABASE_URL` and run the setup above. Replace `application_login` with that URL's login role and `application_database` with its database name (quote identifiers if needed). Ensure Vercel's production environment has `DATABASE_DDL_ROLE=postaichan_ddl`, then rerun migrations and redeploy. The migration and seed preflights report incomplete bootstrap explicitly, including when a required role is missing.

Configure the same `DATABASE_URL` for the application and one-shot migration/seed jobs. This single-login setup is less isolated: compromise of the application credential can assume `postaichan_ddl`, so use a strong provider-managed secret, restrict who can read it, and prefer separate logins if the deployment later allows that operational complexity. The migration script checks the role bootstrap before applying production migrations and fails without printing the URL.

The migration runner prepares `pgcrypto` through the `DATABASE_URL` login before switching to `postaichan_ddl`: it revokes the extension functions' `PUBLIC` execute grants, grants execution to `postaichan_ddl`, and verifies the ACL. It also transfers legacy public-schema objects to `postaichan_ddl` when the login is authorized; otherwise the database owner must transfer them before an upgrade can continue. Some providers preinstall extension functions owned by a provider role; the login must be authorized to apply those ACL changes, or the DBA must perform them before migration. Migration 034 refuses a `PUBLIC` function execute grant rather than silently leaving it in place.

For each release, take a backup, run `pnpm run db:migrate` as a one-shot job with `NODE_ENV=production`, `DATABASE_URL`, and `DATABASE_DDL_ROLE=postaichan_ddl`, verify readiness, then deploy the app with the same `DATABASE_URL`. Run `pnpm run db:seed` only as an explicit administrator operation with that same `DATABASE_URL`; it is idempotent and is not part of normal application startup. If `DATABASE_URL` uses a Neon pooled hostname, migration and seed scripts derive its direct hostname for session-level migration behavior while preserving the same credentials and connection options; application traffic retains the configured pooled URL.

## Security and payment operations

Customer and staff access values are opaque tokens; the database stores hashes. Prices, modifiers, table authorization, stock reservations, settlement, cancellation, refunds, and idempotency are enforced by PostgreSQL. Midtrans webhooks are signature-checked over the exact received signed strings before any database state changes. Settlement accounting uses Midtrans `settlement_time`, then `transaction_time` when the former is absent or invalid, and receipt time only if both provider timestamps are unusable. Refund attempts are durable and use a stable provider refund key across retries. The admin reconciliation view at `/admin/reconciliation` lists orphaned settlements, unresolved provider alerts, and refund attempts that need confirmation.

The app generates nonce-based CSP headers for rendered pages, with `strict-dynamic` scripts, narrow image/connect sources, no objects or frames, and HSTS only in production. The app origin and HTTPS ingress must agree. The readiness endpoints are `/api/health/live` and `/api/health/ready`; the latter performs a bounded database ping and returns no connection details.

Configure reverse-proxy and CDN access logs to redact query parameters `table` and `g`, and redact path segments for `/order/t/<token>` and `/order/g/<token>`. These URLs carry QR credentials. Also redact authorization headers, cookies, request bodies for login/password/refund endpoints, and Midtrans webhook signatures. Application logs emit JSON with a request ID and operational IDs/statuses; they do not log tokens, passwords, hashes, server keys, or webhook payloads.

### Midtrans production checklist

1. Complete sandbox settlement, timeout, duplicate notification, refund, and reconciliation tests.
2. Set `MIDTRANS_IS_PRODUCTION` to match the production Server Key and configured Midtrans endpoint; keep the key only in server secret storage.
3. Configure the production notification URL and verify a signed settlement reaches the app.
4. Confirm `APP_ORIGIN`, TLS termination, trusted proxy strategy, QR allowlisted hosts, and access-log redaction.
5. Run a low-value transaction and refund, verify settlement/refund timestamps and reports, then enable normal traffic.
6. Keep the reconciliation page monitored; do not fulfill or clear an orphaned settlement without an audited accept/refund action.

## Operations

- **Backups:** take encrypted daily PostgreSQL backups and retain point-in-time recovery/WAL for at least seven days. Keep backups outside the database account and monitor the last successful backup.
- **Restore test:** at least quarterly, restore the latest backup into an isolated PostgreSQL 16 database, apply no production traffic to it, verify migration state, seed/admin access, order/payment/refund/audit counts, and application readiness, then record the result before deleting the test restore.
- **Session and event retention:** expired customer sessions are removed after seven days, expired/revoked staff sessions after 30 days, rate-limit buckets after seven days, and unsubmitted provider claims after their 60-second lease. Payment events, refund attempts/accounting rows, reconciliation alerts, and audit logs have no automatic purge; retain and back them up under the accounting/audit policy until an approved archival schedule exists.
- **Images:** menu images are sanitized WebP bytes stored in PostgreSQL and served at `/uploads/menu/<id>.webp`. This is durable across immutable/serverless deploys and is included in database backup/restore. Do not switch back to local `public/uploads/menu` writes on ephemeral storage.
- **Health:** use `/api/health/live` for process liveness and `/api/health/ready` for bounded database readiness. Neither reports credentials, schema details, versions, or stack traces.
- **Production merge checks:** require the `production-checks` status on `main` after the workflow is installed; repository rules are configured in GitHub, not by the application.

## Verification

The CI workflow runs a clean migration chain and seed twice against PostgreSQL 16, then unit tests, DB/API/concurrency integration tests on a separate runtime login, typecheck, ESLint, a production build with production CSP configuration, and the documented production/full dependency audit policy in [SECURITY.md](SECURITY.md).

```bash
pnpm ci
pnpm run db:up
pnpm run db:migrate
pnpm run db:seed
pnpm run test:unit
pnpm run test:db
pnpm run typecheck
pnpm run lint
pnpm run build
node scripts/audit-dependencies.mjs
```

`pnpm run test:db` requires `DATABASE_TEST_ADMIN_URL` and `DATABASE_TEST_URL` to point at the same isolated database whose name ends in `_test`; it refuses an unmarked database. It uses separate connections in its concurrency cases and must never be given a production URL.

## Project shape

```text
app/                 Next.js pages and route handlers
components/          customer, POS, admin and reconciliation UI
db/migrations/       additive PostgreSQL migration history
db/seed.sql          idempotent starter menu data
lib/                 domain, auth, payments, reporting and security code
scripts/             migration and seed runners
tests/               unit and PostgreSQL integration/concurrency suites
```
