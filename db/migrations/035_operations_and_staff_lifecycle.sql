-- Keep pending-public reservations bounded, scope shift close to its own work,
-- and make staff session/password lifecycle operations atomic and auditable.
create index if not exists payments_pending_expiry_idx on public.payments(expires_at) where status = 'pending';
create index if not exists payments_provider_claim_cleanup_idx on public.payments(provider_creation_claimed_at) where provider_creation_claim_token is not null;
create index if not exists orders_shift_id_idx on public.orders(shift_id);
create index if not exists payment_events_retention_idx on public.payment_events(created_at);

create or replace function public.cleanup_stale_sessions_and_rate_limits()
returns table(customer_sessions_deleted bigint, staff_sessions_deleted bigint, rate_limit_buckets_deleted bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.orders set customer_session_id = null
  where customer_session_id in (select id from public.customer_sessions where expires_at < timezone('utc', now()) - interval '7 days');
  delete from public.customer_sessions where expires_at < timezone('utc', now()) - interval '7 days';
  get diagnostics customer_sessions_deleted = row_count;
  delete from public.staff_sessions where expires_at < timezone('utc', now()) - interval '30 days' or revoked_at < timezone('utc', now()) - interval '30 days';
  get diagnostics staff_sessions_deleted = row_count;
  delete from public.rate_limit_buckets where updated_at < timezone('utc', now()) - interval '7 days';
  get diagnostics rate_limit_buckets_deleted = row_count;
  update public.payments set provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_error = coalesce(provider_error, 'provider_claim_timeout'), updated_at = timezone('utc', now())
  where status = 'pending' and provider_creation_claim_token is not null
    and provider_creation_claimed_at < timezone('utc', now()) - interval '60 seconds';
  return next;
end;
$$;

create or replace function public.close_cashier_shift(p_actor_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_shift public.cashier_shifts%rowtype; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_pending integer;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if v_note is not null and char_length(v_note) > 240 then raise exception 'INVALID_SHIFT_NOTE'; end if;
  perform pg_advisory_xact_lock(hashtext('cashier_shift_open'));
  select * into v_shift from public.cashier_shifts where closed_at is null order by opened_at desc limit 1 for update;
  if not found then raise exception 'NO_OPEN_SHIFT'; end if;
  select count(*) into v_pending from public.payments p join public.orders o on o.id = p.order_id
  where o.shift_id = v_shift.id and p.status = 'pending' and p.expires_at > timezone('utc', now());
  if v_pending > 0 then raise exception 'SHIFT_CLOSE_BLOCKED:%', v_pending; end if;
  update public.cashier_shifts set closed_at = timezone('utc', now()), closed_by = p_actor_id,
    closing_note = v_note, updated_at = timezone('utc', now()) where id = v_shift.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'shift_closed', 'cashier_shift', v_shift.id, jsonb_build_object('note', v_note));
  return v_shift.id;
end;
$$;

create or replace function public.create_staff_session(p_staff_user_id uuid, p_token_hash text, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_session_id uuid;
begin
  if p_token_hash is null or p_expires_at is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at <= timezone('utc', now())
     or p_expires_at > timezone('utc', now()) + interval '12 hours' then raise exception 'INVALID_STAFF_SESSION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_staff_user_id::text, 71));
  perform public.cleanup_stale_sessions_and_rate_limits();
  if not exists (
    select 1 from public.profiles p join public.staff_users u on u.id = p.id
    where p.id = p_staff_user_id and p.active = true and u.email_confirmed = true for update of p
  ) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  update public.staff_sessions set revoked_at = timezone('utc', now())
  where staff_user_id = p_staff_user_id and revoked_at is null and expires_at <= timezone('utc', now());
  with older as (
    select id from public.staff_sessions where staff_user_id = p_staff_user_id and revoked_at is null
    order by last_seen_at desc, created_at desc offset 4
  )
  update public.staff_sessions s set revoked_at = timezone('utc', now()) from older where s.id = older.id;
  insert into public.staff_sessions(staff_user_id, token_hash, expires_at)
  values (p_staff_user_id, p_token_hash, p_expires_at) returning id into v_session_id;
  return v_session_id;
end;
$$;

create or replace function public.revoke_staff_sessions(p_staff_user_id uuid, p_actor_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.staff_sessions set revoked_at = coalesce(revoked_at, timezone('utc', now()))
  where staff_user_id = p_staff_user_id and revoked_at is null;
  get diagnostics v_count = row_count;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'staff_sessions_revoked', 'staff_user', p_staff_user_id, jsonb_build_object('revoked_count', v_count));
  return v_count;
end;
$$;

create or replace function public.change_staff_password(
  p_staff_user_id uuid, p_password_hash text, p_actor_id uuid, p_preserve_token_hash text default null
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer; v_action text;
begin
  if p_password_hash is null or p_actor_id is null or p_password_hash !~ '^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{20,30}\$[A-Za-z0-9_-]{80,100}$'
     or (p_preserve_token_hash is not null and p_preserve_token_hash !~ '^[a-f0-9]{64}$') then raise exception 'INVALID_PASSWORD_RESET'; end if;
  if p_actor_id <> p_staff_user_id and not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_preserve_token_hash is not null and p_actor_id <> p_staff_user_id then raise exception 'INVALID_PRESERVED_SESSION'; end if;
  update public.staff_users set password_hash = p_password_hash, updated_at = timezone('utc', now()) where id = p_staff_user_id;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  update public.staff_sessions set revoked_at = coalesce(revoked_at, timezone('utc', now()))
  where staff_user_id = p_staff_user_id and revoked_at is null
    and (p_preserve_token_hash is null or token_hash <> p_preserve_token_hash);
  get diagnostics v_count = row_count;
  v_action := case when p_actor_id = p_staff_user_id then 'staff_password_changed' else 'staff_password_reset' end;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, v_action, 'staff_user', p_staff_user_id, jsonb_build_object('revoked_session_count', v_count));
  return v_count;
end;
$$;

-- Payment transitions and cancellation acquire order then payment locks. This
-- single ordering prevents a webhook and a cancel request from deadlocking or
-- committing contradictory state after one has observed the other.
create or replace function public.apply_payment_transition(
  p_payment_id uuid, p_next_status public.payment_status, p_provider_status text,
  p_provider_transaction_id text, p_fee_idr integer, p_settled_at timestamptz
) returns table(applied boolean, payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_order_id uuid; v_current_rank integer; v_next_rank integer; v_consumed boolean; v_reopened_for_reconciliation boolean := false;
begin
  if coalesce(p_fee_idr, 0) < 0 then raise exception 'INVALID_PAYMENT_FEE'; end if;
  select order_id into v_order_id from public.payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.order_id <> v_order_id then raise exception 'PAYMENT_NOT_FOUND'; end if;
  v_current_rank := case v_payment.status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  v_next_rank := case p_next_status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  if v_payment.status <> p_next_status and (v_next_rank < v_current_rank or (v_payment.status in ('failed','expired') and p_next_status in ('failed','expired'))) then
    applied := false; payment_status := v_payment.status; order_status := v_order.status; return next; return;
  end if;
  if p_next_status = 'settled' and v_payment.status = 'pending' and v_order.status = 'cancelled' then
    -- A provider can deliver a settlement notification after the local cancel
    -- transaction committed. Reopen the operational state into a paid but
    -- explicitly orphaned settlement so no order is left locally cancelled
    -- while money is captured; fulfillment still requires admin reconciliation.
    update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id;
    v_order.status := 'paid';
    v_reopened_for_reconciliation := true;
  end if;
  if p_next_status = 'settled' and v_payment.status = 'pending' and v_order.status in ('draft','awaiting_payment') then
    v_consumed := public.consume_inventory_reservation(v_payment.id);
    if v_consumed then
      update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status in ('draft','awaiting_payment');
      v_order.status := 'paid';
    end if;
  elsif p_next_status in ('failed','expired') then
    perform public.release_inventory_reservation(v_payment.id, case when p_next_status = 'expired' then 'expired'::public.inventory_reservation_status else 'released'::public.inventory_reservation_status end);
  end if;
  update public.payments set status = p_next_status,
    last_provider_status = coalesce(p_provider_status, last_provider_status),
    provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
    fee_idr = greatest(v_payment.fee_idr, coalesce(p_fee_idr, v_payment.fee_idr)),
    settled_at = case when p_next_status = 'settled' then coalesce(v_payment.settled_at, p_settled_at, timezone('utc', now())) else v_payment.settled_at end,
    orphaned_settlement = case when p_next_status = 'settled' and (v_order.status not in ('paid','accepted','processing','ready','completed') or not exists (select 1 from public.inventory_reservations where payment_id = v_payment.id and status = 'consumed')) then true else orphaned_settlement end,
    provider_creation_claim_token = null, provider_creation_claimed_at = null, provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id;
  if v_reopened_for_reconciliation then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (null, 'late_settlement_after_cancellation', 'order', v_order.id,
      jsonb_build_object('status', 'cancelled'), jsonb_build_object('status', 'paid', 'payment_id', v_payment.id, 'orphaned_settlement', true));
  end if;
  applied := true; payment_status := p_next_status; order_status := v_order.status; return next;
end;
$$;

create or replace function public.update_staff_profile(p_user_id uuid, p_active boolean, p_role public.staff_role, p_actor_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_profile public.profiles%rowtype; v_old public.profiles%rowtype; v_admin_count integer; v_revoked integer;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  v_old := v_profile;
  if p_user_id = p_actor_id and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') then raise exception 'SELF_ADMIN_PROTECTION'; end if;
  select count(*) into v_admin_count from public.profiles where role = 'admin' and active = true;
  if v_profile.role = 'admin' and v_profile.active and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') and v_admin_count <= 1 then raise exception 'LAST_ACTIVE_ADMIN'; end if;
  update public.profiles set active = coalesce(p_active, active), role = coalesce(p_role, role), updated_at = timezone('utc', now()) where id = p_user_id returning * into v_profile;
  if v_old.active and not v_profile.active then
    update public.staff_sessions set revoked_at = coalesce(revoked_at, timezone('utc', now())) where staff_user_id = p_user_id and revoked_at is null;
    get diagnostics v_revoked = row_count;
  else v_revoked := 0;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'staff_updated', 'profile', p_user_id,
    jsonb_build_object('active', v_old.active, 'role', v_old.role),
    jsonb_build_object('active', v_profile.active, 'role', v_profile.role, 'revoked_session_count', v_revoked));
  return v_profile;
end;
$$;

create or replace function public.enforce_public_reservation_limit()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_customer_session_id uuid; v_active integer;
begin
  if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then return new; end if;
  select customer_session_id into v_customer_session_id from public.orders where id = new.order_id;
  if v_customer_session_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('public_pending_order_reservations'));
  select count(*) into v_active from public.payments p join public.orders o on o.id = p.order_id
  where o.customer_session_id is not null and p.status = 'pending' and p.expires_at > timezone('utc', now());
  if v_active >= 300 then raise exception 'PUBLIC_RESERVATION_LIMIT'; end if;
  return new;
end;
$$;
drop trigger if exists payments_public_reservation_limit on public.payments;
create trigger payments_public_reservation_limit before insert or update of status on public.payments
for each row execute function public.enforce_public_reservation_limit();

create or replace function public.consume_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.rate_limit_buckets%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_bucket_key) > 200 then return false; end if;
  if random() < 0.005 then
    delete from public.rate_limit_buckets where updated_at < timezone('utc', now()) - interval '7 days';
  end if;
  insert into public.rate_limit_buckets(bucket_key, window_started_at, request_count)
  values (p_bucket_key, timezone('utc', now()), 1)
  on conflict (bucket_key) do update set
    request_count = case when extract(epoch from (timezone('utc', now()) - rate_limit_buckets.window_started_at)) >= p_window_seconds then 1 else rate_limit_buckets.request_count + 1 end,
    window_started_at = case when extract(epoch from (timezone('utc', now()) - rate_limit_buckets.window_started_at)) >= p_window_seconds then timezone('utc', now()) else rate_limit_buckets.window_started_at end,
    updated_at = timezone('utc', now())
  returning * into v_row;
  return v_row.request_count <= p_limit;
end;
$$;

create or replace function public.prepare_provider_confirmed_refund_attempt(
  p_payment_id uuid, p_refund_key text, p_amount_idr integer, p_reason text, p_actor_id uuid
) returns table(attempt_id uuid, amount_idr integer, refund_key text, idempotency_key uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_attempt public.refund_attempts%rowtype; v_reserved bigint; v_idempotency uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_refund_key is null or char_length(p_refund_key) not between 1 and 160
     or p_amount_idr is null or p_amount_idr <= 0
     or p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then raise exception 'INVALID_PROVIDER_REFUND_RECONCILIATION'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'midtrans' or v_payment.method <> 'qris'
     or v_payment.status not in ('settled','partially_refunded') then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  select * into v_attempt from public.refund_attempts where refund_key = p_refund_key for update;
  if found then
    if v_attempt.payment_id <> p_payment_id or v_attempt.amount_idr <> p_amount_idr then raise exception 'REFUND_IDEMPOTENCY_CONFLICT'; end if;
    attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr; refund_key := v_attempt.refund_key; idempotency_key := v_attempt.idempotency_key; return next; return;
  end if;
  select coalesce(sum(amount_idr), 0) into v_reserved from public.refund_attempts
  where payment_id = p_payment_id and state in ('claimed','submitted','needs_reconciliation');
  if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  v_idempotency := (substr(md5(p_payment_id::text || ':' || p_refund_key),1,8) || '-' || substr(md5(p_payment_id::text || ':' || p_refund_key),9,4) || '-5' || substr(md5(p_payment_id::text || ':' || p_refund_key),14,3) || '-a' || substr(md5(p_payment_id::text || ':' || p_refund_key),18,3) || '-' || substr(md5(p_payment_id::text || ':' || p_refund_key),21,12))::uuid;
  insert into public.refund_attempts(payment_id, amount_idr, idempotency_key, refund_key, reason, actor_id, state, provider_metadata)
  values (p_payment_id, p_amount_idr, v_idempotency, p_refund_key, trim(p_reason), p_actor_id, 'needs_reconciliation', jsonb_build_object('origin','provider_status_reconciliation'))
  returning * into v_attempt;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'provider_refund_reconciliation_started', 'payment', p_payment_id,
    jsonb_build_object('refund_attempt_id', v_attempt.id, 'amount_idr', v_attempt.amount_idr, 'refund_key', v_attempt.refund_key));
  attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr; refund_key := v_attempt.refund_key; idempotency_key := v_attempt.idempotency_key; return next;
end;
$$;
