-- Keep failed provider creation from holding a reservation until the normal
-- QR timeout, and persist every finalized refund as an accounting event.
create or replace function public.release_payment_provider_create(p_payment_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.payments
  set provider_creation_claimed_at = null,
      provider_error = left(p_error, 240),
      status = 'failed',
      updated_at = timezone('utc', now())
  where id = p_payment_id and status = 'pending';
  if found then
    perform public.release_inventory_reservation(p_payment_id, 'released'::public.inventory_reservation_status);
  end if;
end;
$$;

create or replace function public.apply_payment_refund(p_payment_id uuid, p_amount_idr integer, p_actor_id uuid, p_reason text)
returns table(payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_refunded integer;
  v_refund_key text;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then raise exception 'INVALID_REFUND_REASON'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_payment.refund_claimed_amount_idr is distinct from p_amount_idr then raise exception 'REFUND_CLAIM_MISMATCH'; end if;
  if p_amount_idr is null or p_amount_idr <= 0 then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  v_refunded := v_payment.refunded_amount_idr + p_amount_idr;
  if v_refunded > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  v_refund_key := 'refund-' || v_payment.provider_order_id || '-' || v_refunded;

  update public.payments
  set refunded_amount_idr = v_refunded,
      status = case when v_refunded = amount_idr then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
      last_provider_status = 'refund',
      refund_claimed_at = null,
      refund_claimed_amount_idr = null,
      updated_at = timezone('utc', now())
  where id = v_payment.id;

  insert into public.payment_refunds(payment_id, amount_idr, refund_key, reason, actor_id)
  values (v_payment.id, p_amount_idr, v_refund_key, trim(p_reason), p_actor_id);

  update public.orders
  set status = case when v_refunded = v_payment.amount_idr then 'refunded'::public.order_status else status end,
      updated_at = timezone('utc', now())
  where id = v_order.id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    p_actor_id,
    'payment_refunded',
    'payment',
    v_payment.id,
    jsonb_build_object('refunded_amount_idr', v_payment.refunded_amount_idr),
    jsonb_build_object('refunded_amount_idr', v_refunded, 'order_id', v_order.id, 'reason', left(trim(p_reason), 240))
  );

  payment_status := case when v_refunded = v_payment.amount_idr then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end;
  order_status := case when v_refunded = v_payment.amount_idr then 'refunded'::public.order_status else v_order.status end;
  return next;
end;
$$;
