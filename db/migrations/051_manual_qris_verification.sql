-- QRIS manual is an onsite merchant scan, not a Midtrans transaction.
-- Preserve method='qris' for settlement reports, and distinguish providers.
-- All transitions are staff-authorized, auditable and atomic.
create or replace function public.create_manual_qris_intent(
  p_idempotency_key uuid, p_idempotency_fingerprint text,
  p_session_hash text, p_table_id uuid, p_actor_id uuid,
  p_payment_method public.payment_method, p_items jsonb
) returns table(
  order_id uuid, order_number text, payment_id uuid,
  payment_status public.payment_status, amount_idr integer,
  provider_order_id text, qr_string text, expires_at timestamptz, replayed boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_intent record;
  v_provider text;
begin
  if p_session_hash is not null or not public.is_staff_actor(p_actor_id)
     or p_payment_method <> 'qris' then raise exception 'MANUAL_QRIS_STAFF_ONLY'; end if;
  select * into v_intent from public.create_checkout_intent(
    p_idempotency_key, p_idempotency_fingerprint, null, p_table_id,
    p_actor_id, 'qris'::public.payment_method, p_items
  );
  if not found then raise exception 'MANUAL_QRIS_INTENT_MISSING'; end if;
  -- The intent and provider assignment happen in the SAME database transaction.
  update public.payments set provider = 'manual_qris',
    updated_at = timezone('utc', now())
  where id = v_intent.payment_id and provider = 'midtrans' and status = 'pending';
  select provider into v_provider from public.payments where id = v_intent.payment_id;
  if v_provider is distinct from 'manual_qris' then
    raise exception 'MANUAL_QRIS_PROVIDER_CONFLICT';
  end if;
  return query select v_intent.order_id::uuid, v_intent.order_number::text,
    v_intent.payment_id::uuid, v_intent.payment_status::public.payment_status,
    v_intent.amount_idr::integer, v_intent.provider_order_id::text,
    null::text, v_intent.expires_at::timestamptz, v_intent.replayed::boolean;
end;
$$;

create or replace function public.verify_manual_qris_payment(
  p_order_id uuid, p_actor_id uuid
) returns table(payment_status public.payment_status, order_status public.order_status, already_verified boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_transition record;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into v_payment from public.payments
    where order_id = p_order_id order by created_at desc limit 1 for update;
  if not found or v_payment.provider <> 'manual_qris' or v_payment.method <> 'qris'
     then raise exception 'NOT_MANUAL_QRIS'; end if;
  if v_payment.status = 'settled' and v_order.status in ('paid','accepted','processing','ready','completed') then
    return query select v_payment.status, v_order.status, true; return;
  end if;
  if v_order.status <> 'awaiting_payment' or v_payment.status <> 'pending'
     or v_payment.expires_at is null or v_payment.expires_at <= timezone('utc',now())
     then raise exception 'MANUAL_QRIS_NO_LONGER_PENDING'; end if;
  if not exists (select 1 from public.cashier_shifts where closed_at is null)
     then raise exception 'CASHIER_SHIFT_CLOSED'; end if;
  select * into v_transition from public.apply_payment_transition(
    v_payment.id, 'settled'::public.payment_status,
    'manual_verified_by_staff', null, 0, timezone('utc', now())
  );
  if v_transition.payment_status <> 'settled' or v_transition.order_status <> 'paid'
     or exists(select 1 from public.payments where id = v_payment.id and orphaned_settlement)
     then raise exception 'MANUAL_QRIS_INVENTORY_CONFLICT'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'manual_qris_verified', 'order', p_order_id,
          jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_payment.amount_idr,
                             'verified_at', timezone('utc', now())));
  return query select 'settled'::public.payment_status, 'paid'::public.order_status, false;
end;
$$;

revoke all on function public.create_manual_qris_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb) from public;
revoke all on function public.verify_manual_qris_payment(uuid,uuid) from public;
grant execute on function public.create_manual_qris_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb) to postaichan_runtime;
grant execute on function public.verify_manual_qris_payment(uuid,uuid) to postaichan_runtime;
