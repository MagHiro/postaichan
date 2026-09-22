-- Allow a customer to cancel only their own unpaid order. Provider expiry is
-- performed by the route before this function so a live QR is not left open.
create or replace function public.cancel_customer_order(p_order_id uuid, p_session_hash text)
returns table(cancelled boolean, order_status public.order_status, payment_status public.payment_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_payment_id uuid;
begin
  if p_session_hash is null then raise exception 'SESSION_EXPIRED'; end if;

  select o.* into v_order
  from public.orders o
  join public.customer_sessions cs on cs.id = o.customer_session_id
  where o.id = p_order_id
    and cs.access_token_hash = p_session_hash
    and cs.expires_at > timezone('utc', now())
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_payment from public.payments where order_id = v_order.id order by created_at desc limit 1 for update;
  if v_order.status not in ('draft', 'awaiting_payment') or exists (select 1 from public.payments where order_id = v_order.id and status in ('settled', 'partially_refunded', 'refunded')) then
    cancelled := false;
    order_status := v_order.status;
    payment_status := v_payment.status;
    return next;
    return;
  end if;

  update public.orders
  set status = 'cancelled', updated_at = timezone('utc', now())
  where id = v_order.id and status in ('draft', 'awaiting_payment');

  for v_payment_id in select id from public.payments where order_id = v_order.id loop
    update public.payments
    set status = case when status = 'pending' then 'expired'::public.payment_status else status end,
        last_provider_status = case when status = 'pending' then 'cancelled_by_customer' else last_provider_status end,
        provider_creation_claimed_at = null,
        updated_at = timezone('utc', now())
    where id = v_payment_id;
    perform public.release_inventory_reservation(v_payment_id, 'released'::public.inventory_reservation_status);
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (null, 'customer_order_cancelled', 'order', v_order.id, jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled'));

  cancelled := true;
  order_status := 'cancelled';
  payment_status := case when v_payment.status = 'pending' then 'expired'::public.payment_status else v_payment.status end;
  return next;
end;
$$;
