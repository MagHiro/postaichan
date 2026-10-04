-- Keep the provider's observed expiry no later than the authoritative local
-- deadline. Provider timestamps may be second-granular, so a slightly earlier
-- provider expiry shortens both the payment and its inventory reservation.
alter table public.payments add column if not exists provider_expires_at timestamptz;

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
  if v_payment.expires_at is null or v_payment.expires_at <= timezone('utc', now()) + interval '60 seconds' then
    update public.payments set status = 'expired', last_provider_status = 'local_expiry_before_provider_create',
      provider_creation_claim_token = null, provider_creation_claimed_at = null, updated_at = timezone('utc', now())
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
    provider_creation_claimed_at = timezone('utc', now()), provider_error = null,
    updated_at = timezone('utc', now())
  where id = v_payment.id and status = 'pending' and qr_string is null
    and expires_at > timezone('utc', now()) + interval '60 seconds'
  returning provider_creation_claim_token into v_token;
  claimed := found; claim_token := case when found then v_token else null end; expired := false;
  return next;
end;
$$;

create or replace function public.finalize_payment_provider_create(
  p_payment_id uuid, p_claim_token uuid, p_provider_transaction_id text,
  p_qr_material text, p_provider_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_effective_expiry timestamptz;
begin
  select o.* into v_order from public.orders o
  join public.payments p on p.order_id = o.id where p.id = p_payment_id for update of o;
  if not found then return false; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.order_id <> v_order.id or v_payment.status <> 'pending'
     or v_payment.provider_creation_claim_token is distinct from p_claim_token
     or v_payment.provider_creation_claimed_at is null
     or v_payment.provider_creation_claimed_at <= timezone('utc', now()) - interval '60 seconds'
     or v_payment.expires_at is null or v_payment.expires_at <= timezone('utc', now()) + interval '60 seconds'
     or (p_provider_expires_at is not null and (p_provider_expires_at > v_payment.expires_at or p_provider_expires_at <= timezone('utc', now()) + interval '60 seconds'))
     or p_qr_material is null or char_length(p_qr_material) > 12000
     or p_provider_transaction_id is null or char_length(p_provider_transaction_id) not between 1 and 120 then
    return false;
  end if;
  if v_order.status <> 'awaiting_payment'
     or exists (select 1 from public.payments where order_id = v_order.id and id <> v_payment.id and status in ('settled','partially_refunded','refunded')) then
    return false;
  end if;
  v_effective_expiry := least(v_payment.expires_at, coalesce(p_provider_expires_at, v_payment.expires_at));
  update public.payments set provider_transaction_id = p_provider_transaction_id,
    qr_string = p_qr_material, provider_created_at = timezone('utc', now()),
    provider_expires_at = p_provider_expires_at, expires_at = v_effective_expiry,
    provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id and status = 'pending' and provider_creation_claim_token = p_claim_token;
  if not found then return false; end if;
  update public.inventory_reservations set expires_at = least(expires_at, v_effective_expiry), updated_at = timezone('utc', now())
  where payment_id = p_payment_id and status = 'reserved';
  return true;
end;
$$;

-- Match webhook/cancel lock order: order before payment. A reconciliation
-- fulfillment cannot deadlock against a concurrent settlement notification.
create or replace function public.reconcile_orphaned_settlement(
  p_payment_id uuid, p_action text, p_actor_id uuid, p_reason text
) returns table(resolved boolean, order_status public.order_status, payment_status public.payment_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_old_order_status public.order_status;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_action <> 'accept' then raise exception 'REFUND_REQUIRES_DURABLE_WORKFLOW'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then raise exception 'INVALID_RECONCILIATION_REASON'; end if;
  select order_id into v_order_id from public.payments where id = p_payment_id;
  if not found then raise exception 'ORPHANED_SETTLEMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'ORPHANED_SETTLEMENT_NOT_FOUND'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.order_id <> v_order.id or v_payment.status <> 'settled' or not v_payment.orphaned_settlement then raise exception 'ORPHANED_SETTLEMENT_NOT_FOUND'; end if;
  v_old_order_status := v_order.status;
  if not public.consume_orphaned_settlement_inventory(v_payment.id) then raise exception 'ORPHANED_SETTLEMENT_STOCK_UNAVAILABLE'; end if;
  update public.payments set orphaned_settlement = false, updated_at = timezone('utc', now()) where id = v_payment.id;
  update public.orders set status = case when status in ('draft','awaiting_payment','cancelled') then 'paid'::public.order_status else status end,
    updated_at = timezone('utc', now()) where id = v_order.id returning * into v_order;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'orphaned_settlement_accepted', 'payment', v_payment.id,
    jsonb_build_object('orphaned_settlement', true, 'order_status', v_old_order_status),
    jsonb_build_object('orphaned_settlement', false, 'order_status', v_order.status, 'reason', trim(p_reason)));
  resolved := true; order_status := v_order.status; payment_status := v_payment.status; return next;
end;
$$;
