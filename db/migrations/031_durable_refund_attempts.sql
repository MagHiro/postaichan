-- A refund attempt is durable before any request reaches Midtrans. The client
-- idempotency key remains stable across crashes and retries.
create table if not exists public.refund_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_idr integer not null check (amount_idr > 0),
  idempotency_key uuid not null,
  refund_key text not null unique,
  reason text not null check (char_length(trim(reason)) between 3 and 240),
  actor_id uuid not null references public.staff_users(id),
  state text not null default 'claimed' check (state in ('claimed','submitted','confirmed','failed','needs_reconciliation')),
  claim_token uuid,
  claimed_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (payment_id, idempotency_key)
);
create index if not exists refund_attempts_reconciliation_idx
  on public.refund_attempts(state, updated_at desc) where state in ('submitted','needs_reconciliation');
create index if not exists refund_attempts_payment_idx on public.refund_attempts(payment_id, created_at desc);
create index if not exists payment_refunds_actor_idx on public.payment_refunds(actor_id, processed_at desc);

create or replace function public.claim_payment_refund(
  p_payment_id uuid, p_amount_idr integer, p_reason text,
  p_idempotency_key uuid, p_actor_id uuid
) returns table(attempt_id uuid, amount_idr integer, provider_order_id text,
  refund_key text, attempt_state text, claim_token uuid, already_confirmed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_attempt public.refund_attempts%rowtype;
  v_reserved bigint;
  v_token uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_idempotency_key is null or p_reason is null or char_length(trim(p_reason)) not between 3 and 240
     or p_amount_idr is null or p_amount_idr <= 0 then raise exception 'INVALID_REFUND_REQUEST'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('settled','partially_refunded')
     or v_payment.method <> 'qris' or v_payment.provider <> 'midtrans' then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;

  select * into v_attempt from public.refund_attempts
  where payment_id = p_payment_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_attempt.amount_idr <> p_amount_idr or v_attempt.reason <> trim(p_reason) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT'; end if;
    if v_attempt.state = 'confirmed' then
      attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr; provider_order_id := v_payment.provider_order_id;
      refund_key := v_attempt.refund_key; attempt_state := v_attempt.state; claim_token := null; already_confirmed := true; return next; return;
    end if;
    if v_attempt.claim_token is not null and v_attempt.claimed_at > timezone('utc', now()) - interval '60 seconds' then raise exception 'REFUND_IN_PROGRESS'; end if;
    select coalesce(sum(amount_idr), 0) into v_reserved from public.refund_attempts
    where payment_id = p_payment_id and id <> v_attempt.id and state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    update public.refund_attempts set state = 'claimed', claim_token = v_token,
      claimed_at = timezone('utc', now()), attempt_count = attempt_count + 1,
      last_error_code = null, updated_at = timezone('utc', now())
    where id = v_attempt.id returning * into v_attempt;
  else
    select coalesce(sum(amount_idr), 0) into v_reserved from public.refund_attempts
    where payment_id = p_payment_id and state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    insert into public.refund_attempts(payment_id, amount_idr, idempotency_key, refund_key, reason, actor_id, claim_token, claimed_at)
    values (p_payment_id, p_amount_idr, p_idempotency_key,
      'refund-' || left(encode(digest(p_payment_id::text || ':' || p_idempotency_key::text, 'sha256'), 'hex'), 40),
      trim(p_reason), p_actor_id, v_token, timezone('utc', now()))
    returning * into v_attempt;
  end if;
  attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr; provider_order_id := v_payment.provider_order_id;
  refund_key := v_attempt.refund_key; attempt_state := v_attempt.state; claim_token := v_attempt.claim_token; already_confirmed := false;
  return next;
end;
$$;

create or replace function public.set_refund_attempt_state(
  p_attempt_id uuid, p_claim_token uuid, p_state text, p_error_code text, p_metadata jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_state not in ('claimed','submitted','confirmed','failed','needs_reconciliation') then raise exception 'INVALID_REFUND_STATE'; end if;
  update public.refund_attempts set state = p_state,
    claim_token = case when p_state in ('claimed','submitted','needs_reconciliation') then claim_token else null end,
    claimed_at = case when p_state in ('claimed','submitted','needs_reconciliation') then claimed_at else null end,
    submitted_at = case when p_state in ('submitted','needs_reconciliation','confirmed') then coalesce(submitted_at, timezone('utc', now())) else submitted_at end,
    confirmed_at = case when p_state = 'confirmed' then coalesce(confirmed_at, timezone('utc', now())) else confirmed_at end,
    last_error_code = left(p_error_code, 80), provider_metadata = provider_metadata || coalesce(p_metadata, '{}'::jsonb),
    updated_at = timezone('utc', now())
  where id = p_attempt_id and claim_token = p_claim_token and state <> 'confirmed';
  return found;
end;
$$;

create or replace function public.finalize_payment_refund_attempt(
  p_attempt_id uuid, p_claim_token uuid, p_actor_id uuid
) returns table(payment_status public.payment_status, order_status public.order_status, refunded_amount_idr integer, already_applied boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_attempt public.refund_attempts%rowtype;
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_refunded integer;
  v_inserted uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select * into v_attempt from public.refund_attempts where id = p_attempt_id for update;
  if not found then raise exception 'REFUND_ATTEMPT_NOT_FOUND'; end if;
  select o.* into v_order from public.orders o join public.payments p on p.order_id = o.id where p.id = v_attempt.payment_id for update of o;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_payment from public.payments where id = v_attempt.payment_id for update;
  if v_attempt.state = 'confirmed' or exists (select 1 from public.payment_refunds where refund_key = v_attempt.refund_key) then
    update public.refund_attempts set state = 'confirmed', claim_token = null, claimed_at = null,
      confirmed_at = coalesce(confirmed_at, timezone('utc', now())), updated_at = timezone('utc', now()) where id = v_attempt.id;
    payment_status := v_payment.status; order_status := v_order.status;
    refunded_amount_idr := v_payment.refunded_amount_idr; already_applied := true; return next; return;
  end if;
  if p_claim_token is null or v_attempt.claim_token is distinct from p_claim_token
     or v_attempt.state not in ('claimed','submitted','needs_reconciliation') then raise exception 'REFUND_CLAIM_MISMATCH'; end if;
  if v_payment.refunded_amount_idr::bigint + v_attempt.amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  v_refunded := v_payment.refunded_amount_idr + v_attempt.amount_idr;
  insert into public.payment_refunds(payment_id, amount_idr, refund_key, reason, actor_id)
  values (v_payment.id, v_attempt.amount_idr, v_attempt.refund_key, v_attempt.reason, v_attempt.actor_id)
  on conflict (refund_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
    update public.payments set refunded_amount_idr = v_refunded,
      status = case when v_refunded = amount_idr then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
      last_provider_status = case when v_refunded = amount_idr then 'refund' else 'partial_refund' end,
      refund_claimed_at = null, refund_claimed_amount_idr = null, updated_at = timezone('utc', now())
    where id = v_payment.id returning * into v_payment;
    update public.orders set status = case when v_refunded = v_payment.amount_idr then 'refunded'::public.order_status else status end,
      updated_at = timezone('utc', now()) where id = v_order.id returning * into v_order;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'payment_refunded', 'payment', v_payment.id,
      jsonb_build_object('refunded_amount_idr', v_refunded - v_attempt.amount_idr),
      jsonb_build_object('refunded_amount_idr', v_refunded, 'refund_attempt_id', v_attempt.id, 'order_id', v_order.id, 'reason', v_attempt.reason));
    already_applied := false;
  else
    select * into v_payment from public.payments where id = v_attempt.payment_id;
    select * into v_order from public.orders where id = v_payment.order_id;
    already_applied := true;
  end if;
  update public.refund_attempts set state = 'confirmed', claim_token = null, claimed_at = null,
    confirmed_at = coalesce(confirmed_at, timezone('utc', now())), last_error_code = null,
    updated_at = timezone('utc', now()) where id = v_attempt.id;
  payment_status := v_payment.status; order_status := v_order.status;
  refunded_amount_idr := v_payment.refunded_amount_idr; return next;
end;
$$;

create or replace function public.mark_provider_refund_notification(
  p_payment_id uuid, p_provider_status text, p_metadata jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer; v_keys jsonb := coalesce(p_metadata->'refundKeys', '[]'::jsonb); v_alert_key text;
begin
  if p_provider_status not in ('refund','partial_refund') then raise exception 'INVALID_PROVIDER_REFUND_STATUS'; end if;
  update public.refund_attempts ra set state = 'needs_reconciliation', claim_token = null, claimed_at = null,
    provider_metadata = provider_metadata || coalesce(p_metadata, '{}'::jsonb), updated_at = timezone('utc', now())
  where ra.payment_id = p_payment_id and ra.state <> 'confirmed'
    and (jsonb_array_length(v_keys) = 0 or ra.refund_key in (select jsonb_array_elements_text(v_keys)));
  get diagnostics v_count = row_count;
  if v_count = 0 then
    v_alert_key := 'provider-refund-webhook:' || md5(p_payment_id::text || ':' || p_provider_status || ':' || coalesce(p_metadata::text, ''));
    perform public.record_provider_reconciliation_alert(v_alert_key, p_payment_id,
      'provider_refund_without_local_attempt', jsonb_build_object('providerStatus', p_provider_status, 'metadata', coalesce(p_metadata, '{}'::jsonb)));
  end if;
  return v_count;
end;
$$;

create or replace function public.resolve_provider_reconciliation_alert(
  p_alert_id uuid, p_actor_id uuid, p_resolution text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_resolution is null or char_length(trim(p_resolution)) not between 3 and 240 then raise exception 'INVALID_RECONCILIATION_RESOLUTION'; end if;
  update public.provider_reconciliation_alerts set state = 'resolved', resolution = trim(p_resolution),
    resolved_by = p_actor_id, resolved_at = timezone('utc', now()) where id = p_alert_id and state = 'unresolved';
  if found then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values (p_actor_id, 'provider_reconciliation_resolved', 'provider_reconciliation_alert', p_alert_id, jsonb_build_object('resolution', left(trim(p_resolution), 240)));
  end if;
  return found;
end;
$$;
