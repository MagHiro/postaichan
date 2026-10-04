-- Distinguish an abandoned local claim (safe to retry) from a claim that may
-- already have reached Midtrans (must reconcile before any new charge call).
alter table public.payments
  add column if not exists provider_creation_request_started_at timestamptz;

create or replace function public.claim_payment_provider_create(p_payment_id uuid)
returns table(claimed boolean, claim_token uuid, expired boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_token uuid;
begin
  select order_id into v_order_id from public.payments where id = p_payment_id;
  if not found then claimed := false; claim_token := null; expired := false; return next; return; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found then claimed := false; claim_token := null; expired := false; return next; return; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.order_id <> v_order.id or v_payment.status <> 'pending' or v_payment.qr_string is not null
     or v_order.status <> 'awaiting_payment'
     or exists (select 1 from public.payments where order_id = v_order.id and id <> p_payment_id and status in ('settled','partially_refunded','refunded')) then
    claimed := false; claim_token := null; expired := false; return next; return;
  end if;

  if v_payment.provider_creation_claim_token is not null
     and v_payment.provider_creation_claimed_at <= timezone('utc', now()) - interval '60 seconds'
     and v_payment.provider_creation_request_started_at is not null then
    perform public.record_provider_reconciliation_alert(
      'provider-create-claim-timeout:' || v_payment.id::text || ':' || v_payment.provider_creation_claim_token::text,
      v_payment.id, 'provider_create_outcome_unknown',
      jsonb_build_object('providerOrderId', v_payment.provider_order_id, 'reason', 'claim_timed_out_after_request_started')
    );
    claimed := false; claim_token := null; expired := false; return next; return;
  end if;

  if v_payment.expires_at is null or v_payment.expires_at <= timezone('utc', now()) + interval '60 seconds' then
    update public.payments set status = 'expired', last_provider_status = 'local_expiry_before_provider_create',
      provider_creation_claim_token = null, provider_creation_claimed_at = null,
      provider_creation_request_started_at = null, updated_at = timezone('utc', now())
    where id = v_payment.id;
    perform public.release_inventory_reservation(v_payment.id, 'expired'::public.inventory_reservation_status);
    claimed := false; claim_token := null; expired := true; return next; return;
  end if;
  if v_payment.provider_creation_claim_token is not null
     and v_payment.provider_creation_claimed_at > timezone('utc', now()) - interval '60 seconds' then
    claimed := false; claim_token := null; expired := false; return next; return;
  end if;
  v_token := gen_random_uuid();
  update public.payments set provider_creation_claim_token = v_token,
    provider_creation_claimed_at = timezone('utc', now()), provider_creation_request_started_at = null,
    provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id and status = 'pending' and qr_string is null
    and expires_at > timezone('utc', now()) + interval '60 seconds'
  returning provider_creation_claim_token into v_token;
  claimed := found; claim_token := case when found then v_token else null end; expired := false;
  return next;
end;
$$;

create or replace function public.mark_payment_provider_create_submitted(p_payment_id uuid, p_claim_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype; v_order_id uuid;
begin
  select order_id into v_order_id from public.payments where id = p_payment_id;
  if not found then return false; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.status <> 'awaiting_payment' then return false; end if;
  update public.payments set provider_creation_request_started_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = p_payment_id and order_id = v_order.id and status = 'pending' and qr_string is null
    and provider_creation_claim_token = p_claim_token
    and provider_creation_claimed_at > timezone('utc', now()) - interval '60 seconds'
    and provider_creation_request_started_at is null
    and expires_at > timezone('utc', now()) + interval '60 seconds';
  return found;
end;
$$;

-- Clearing ownership on every completion path prevents a timed-out worker from
-- submitting a second provider charge after an explicit, definitive outcome.
create or replace function public.finalize_payment_provider_create(
  p_payment_id uuid, p_claim_token uuid, p_provider_transaction_id text,
  p_qr_material text, p_provider_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_effective_expiry timestamptz;
begin
  select o.* into v_order from public.orders o join public.payments p on p.order_id = o.id
  where p.id = p_payment_id for update of o;
  if not found then return false; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.order_id <> v_order.id or v_payment.status <> 'pending'
     or v_payment.provider_creation_claim_token is distinct from p_claim_token
     or v_payment.provider_creation_request_started_at is null
     or v_payment.provider_creation_claimed_at is null
     or v_payment.provider_creation_claimed_at <= timezone('utc', now()) - interval '60 seconds'
     or v_payment.expires_at is null or v_payment.expires_at <= timezone('utc', now()) + interval '60 seconds'
     or (p_provider_expires_at is not null and (p_provider_expires_at > v_payment.expires_at or p_provider_expires_at <= timezone('utc', now()) + interval '60 seconds'))
     or p_qr_material is null or char_length(p_qr_material) > 12000
     or p_provider_transaction_id is null or char_length(p_provider_transaction_id) not between 1 and 120 then return false; end if;
  if v_order.status <> 'awaiting_payment'
     or exists (select 1 from public.payments where order_id = v_order.id and id <> v_payment.id and status in ('settled','partially_refunded','refunded')) then return false; end if;
  v_effective_expiry := least(v_payment.expires_at, coalesce(p_provider_expires_at, v_payment.expires_at));
  update public.payments set provider_transaction_id = p_provider_transaction_id,
    qr_string = p_qr_material, provider_created_at = timezone('utc', now()),
    provider_expires_at = p_provider_expires_at, expires_at = v_effective_expiry,
    provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_creation_request_started_at = null, provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id and status = 'pending' and provider_creation_claim_token = p_claim_token;
  if not found then return false; end if;
  update public.inventory_reservations set expires_at = least(expires_at, v_effective_expiry), updated_at = timezone('utc', now())
  where payment_id = p_payment_id and status = 'reserved';
  return true;
end;
$$;

create or replace function public.release_payment_provider_create(
  p_payment_id uuid, p_claim_token uuid, p_error_code text, p_definitive boolean default false
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_changed boolean;
begin
  update public.payments set provider_creation_claim_token = null,
    provider_creation_claimed_at = null, provider_creation_request_started_at = null,
    provider_error = left(coalesce(p_error_code, 'provider_error'), 80),
    status = case when p_definitive then 'failed'::public.payment_status else status end,
    last_provider_status = case when p_definitive then 'provider_create_rejected' else last_provider_status end,
    updated_at = timezone('utc', now())
  where id = p_payment_id and status = 'pending' and provider_creation_claim_token = p_claim_token;
  v_changed := found;
  if v_changed and p_definitive then perform public.release_inventory_reservation(p_payment_id, 'released'::public.inventory_reservation_status); end if;
  return v_changed;
end;
$$;

create or replace function public.cancel_order(
  p_order_id uuid, p_session_hash text, p_actor_id uuid
) returns table(cancelled boolean, order_status public.order_status, payment_status public.payment_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype; v_payment_id uuid;
begin
  if (p_session_hash is null) = (p_actor_id is null) then raise exception 'CANCEL_AUTH_REQUIRED'; end if;
  if p_actor_id is not null and not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if p_actor_id is null then
    select o.* into v_order from public.orders o join public.customer_sessions cs on cs.id = o.customer_session_id
    where o.id = p_order_id and cs.access_token_hash = p_session_hash and cs.expires_at > timezone('utc', now()) for update of o;
  else
    select * into v_order from public.orders where id = p_order_id for update;
  end if;
  if not found then
    if p_actor_id is null and exists (select 1 from public.customer_sessions where access_token_hash = p_session_hash) then raise exception 'SESSION_EXPIRED'; end if;
    raise exception 'ORDER_NOT_FOUND';
  end if;
  select * into v_payment from public.payments where order_id = v_order.id order by created_at desc limit 1 for update;
  if v_order.status not in ('draft','awaiting_payment')
     or exists (select 1 from public.payments where order_id = v_order.id and status in ('settled','partially_refunded','refunded')) then
    cancelled := false; order_status := v_order.status; payment_status := v_payment.status; return next; return;
  end if;
  update public.orders set status = 'cancelled', updated_at = timezone('utc', now()) where id = v_order.id;
  for v_payment_id in select id from public.payments where order_id = v_order.id loop
    update public.payments set status = case when status = 'pending' then 'expired'::public.payment_status else status end,
      last_provider_status = case when status = 'pending' then case when p_actor_id is null then 'cancelled_by_customer' else 'cancelled_by_staff' end else last_provider_status end,
      provider_creation_claim_token = null, provider_creation_claimed_at = null,
      provider_creation_request_started_at = null, updated_at = timezone('utc', now())
    where id = v_payment_id;
    perform public.release_inventory_reservation(v_payment_id, 'released'::public.inventory_reservation_status);
  end loop;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, case when p_actor_id is null then 'customer_order_cancelled' else 'staff_order_cancelled' end,
    'order', v_order.id, jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled'));
  cancelled := true; order_status := 'cancelled';
  payment_status := case when v_payment.status = 'pending' then 'expired'::public.payment_status else v_payment.status end;
  return next;
end;
$$;

create or replace function public.transition_order_status(
  p_order_id uuid, p_expected_status public.order_status,
  p_next_status public.order_status, p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype; v_updated integer;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if not exists (select 1 from (values
    ('paid'::public.order_status,'accepted'::public.order_status),('accepted','processing'),
    ('processing','ready'),('ready','completed'),('draft','cancelled'),('awaiting_payment','cancelled')
  ) as t(a,b) where t.a = p_expected_status and t.b = p_next_status) then return false; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> p_expected_status then return false; end if;
  if p_next_status = 'cancelled' and exists (
    select 1 from public.payments where order_id = p_order_id and status in ('settled','partially_refunded','refunded')
  ) then return false; end if;
  if p_next_status in ('accepted','processing','ready','completed') and not exists (
    select 1 from public.payments where order_id = p_order_id and status in ('settled','partially_refunded','refunded') and orphaned_settlement = false
  ) then return false; end if;
  update public.orders set status = p_next_status, updated_at = timezone('utc', now()) where id = p_order_id and status = p_expected_status;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    if p_next_status = 'cancelled' then
      update public.payments set status = 'expired', last_provider_status = 'cancelled_by_staff',
        provider_creation_claim_token = null, provider_creation_claimed_at = null,
        provider_creation_request_started_at = null, updated_at = timezone('utc', now())
      where order_id = p_order_id and status = 'pending';
      perform public.release_inventory_reservation(payment_id) from public.payments where order_id = p_order_id;
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'order_status_changed', 'order', p_order_id,
      jsonb_build_object('status', p_expected_status), jsonb_build_object('status', p_next_status));
  end if;
  return v_updated = 1;
end;
$$;

create or replace function public.cleanup_stale_sessions_and_rate_limits()
returns table(customer_sessions_deleted bigint, staff_sessions_deleted bigint, rate_limit_buckets_deleted bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.orders set customer_session_id = null
  where customer_session_id in (select id from public.customer_sessions where expires_at < timezone('utc', now()) - interval '7 days');
  delete from public.customer_sessions where expires_at < timezone('utc', now()) - interval '7 days';
  get diagnostics customer_sessions_deleted = row_count;
  delete from public.staff_sessions where expires_at < timezone('utc', now()) - interval '30 days'
    or revoked_at < timezone('utc', now()) - interval '30 days';
  get diagnostics staff_sessions_deleted = row_count;
  delete from public.rate_limit_buckets where updated_at < timezone('utc', now()) - interval '7 days';
  get diagnostics rate_limit_buckets_deleted = row_count;
  -- A stale claim with no request is safe to release. A submitted claim stays
  -- intact so claim_payment_provider_create can emit an alert and require a
  -- provider status reconciliation before any second charge is attempted.
  update public.payments set provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_error = coalesce(provider_error, 'provider_claim_timeout'), updated_at = timezone('utc', now())
  where status = 'pending' and provider_creation_claim_token is not null
    and provider_creation_claimed_at < timezone('utc', now()) - interval '60 seconds'
    and provider_creation_request_started_at is null;
  update public.payments set provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_creation_request_started_at = null, updated_at = timezone('utc', now())
  where status <> 'pending' and provider_creation_claim_token is not null
    and provider_creation_claimed_at < timezone('utc', now()) - interval '60 seconds';
  return next;
end;
$$;

revoke all on function public.mark_payment_provider_create_submitted(uuid, uuid) from public;
grant execute on function public.mark_payment_provider_create_submitted(uuid, uuid) to postaichan_runtime;
