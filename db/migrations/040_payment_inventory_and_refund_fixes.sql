-- Record stock consumption in the inventory ledger and reopen cancelled orders
-- as orphaned paid orders when a provider settlement arrives after cancellation.
create or replace function public.consume_inventory_reservation(p_payment_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_payment public.payments%rowtype;
  v_product_id uuid;
  v_product public.products%rowtype;
  v_quantity integer;
  v_other_reserved integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then return false; end if;
  select * into v_reservation from public.inventory_reservations where payment_id = p_payment_id for update;
  if not found and v_payment.method = 'cash' then
    insert into public.inventory_reservations(order_id, payment_id, status, expires_at)
    values (v_payment.order_id, v_payment.id, 'reserved', timezone('utc', now()) + interval '1 minute') returning * into v_reservation;
    insert into public.inventory_reservation_items(reservation_id, product_id, quantity)
    select v_reservation.id, oi.product_id, sum(oi.quantity) from public.order_items oi
    where oi.order_id = v_payment.order_id group by oi.product_id;
  elsif not found then
    return false;
  end if;
  if v_reservation.status = 'consumed' then return true; end if;
  if v_reservation.status <> 'reserved' or v_reservation.expires_at <= timezone('utc', now()) then
    if v_reservation.status = 'reserved' then
      perform public.release_inventory_reservation(p_payment_id, 'expired'::public.inventory_reservation_status);
    end if;
    return false;
  end if;
  for v_product_id in
    select product_id from public.inventory_reservation_items where reservation_id = v_reservation.id order by product_id
  loop
    select * into v_product from public.products where id = v_product_id for update;
    select quantity into v_quantity from public.inventory_reservation_items
    where reservation_id = v_reservation.id and product_id = v_product_id;
    if v_product.stock_tracked then
      select coalesce(sum(iri.quantity), 0) into v_other_reserved
      from public.inventory_reservation_items iri
      join public.inventory_reservations ir on ir.id = iri.reservation_id
      where iri.product_id = v_product_id and ir.id <> v_reservation.id
        and ir.status = 'reserved' and ir.expires_at > timezone('utc', now());
      if v_product.stock_quantity - v_other_reserved < v_quantity then
        raise exception 'STOCK_CONFLICT:%', v_product.name;
      end if;
      update public.products set stock_quantity = stock_quantity - v_quantity, updated_at = timezone('utc', now())
      where id = v_product_id;
      insert into public.inventory_adjustments(product_id, previous_quantity, new_quantity, adjustment_type, reason, actor_id)
      values (v_product_id, v_product.stock_quantity, v_product.stock_quantity - v_quantity,
        'sale_consumed', 'Payment settlement ' || p_payment_id::text, null);
    end if;
  end loop;
  update public.inventory_reservations set status = 'consumed',
    consumed_at = coalesce(consumed_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where id = v_reservation.id and status = 'reserved';
  return true;
end;
$$;

create or replace function public.apply_payment_transition(
  p_payment_id uuid, p_next_status public.payment_status, p_provider_status text,
  p_provider_transaction_id text, p_fee_idr integer, p_settled_at timestamptz
) returns table(applied boolean, payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_current_rank integer;
  v_next_rank integer;
  v_consumed boolean;
  v_reopened_for_reconciliation boolean := false;
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
  if p_next_status = 'settled' and v_payment.status in ('pending','failed','expired') and v_order.status = 'cancelled' then
    update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id;
    v_order.status := 'paid';
    v_reopened_for_reconciliation := true;
  end if;
  if p_next_status = 'settled' and v_payment.status = 'pending' and v_order.status in ('draft','awaiting_payment') then
    v_consumed := public.consume_inventory_reservation(v_payment.id);
    if v_consumed then
      update public.orders set status = 'paid', updated_at = timezone('utc', now())
      where id = v_order.id and status in ('draft','awaiting_payment');
      v_order.status := 'paid';
    end if;
  elsif p_next_status in ('failed','expired') then
    perform public.release_inventory_reservation(v_payment.id,
      case when p_next_status = 'expired' then 'expired'::public.inventory_reservation_status else 'released'::public.inventory_reservation_status end);
  end if;
  update public.payments set status = p_next_status,
    last_provider_status = coalesce(p_provider_status, last_provider_status),
    provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
    fee_idr = greatest(v_payment.fee_idr, coalesce(p_fee_idr, v_payment.fee_idr)),
    settled_at = case when p_next_status = 'settled' then coalesce(v_payment.settled_at, p_settled_at, timezone('utc', now())) else v_payment.settled_at end,
    orphaned_settlement = case when p_next_status = 'settled' and
      (v_order.status not in ('paid','accepted','processing','ready','completed') or
       not exists (select 1 from public.inventory_reservations where payment_id = v_payment.id and status = 'consumed'))
      then true else orphaned_settlement end,
    provider_creation_claim_token = null, provider_creation_claimed_at = null,
    provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id;
  if v_reopened_for_reconciliation then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (null, 'late_settlement_after_cancellation', 'order', v_order.id,
      jsonb_build_object('status', 'cancelled'),
      jsonb_build_object('status', 'paid', 'payment_id', v_payment.id, 'orphaned_settlement', true));
  end if;
  applied := true; payment_status := p_next_status; order_status := v_order.status; return next;
end;
$$;

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
    select coalesce(sum(ra.amount_idr), 0) into v_reserved from public.refund_attempts ra
    where ra.payment_id = p_payment_id and ra.id <> v_attempt.id and ra.state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    update public.refund_attempts set state = 'claimed', claim_token = v_token,
      claimed_at = timezone('utc', now()), attempt_count = attempt_count + 1,
      last_error_code = null, updated_at = timezone('utc', now())
    where id = v_attempt.id returning * into v_attempt;
  else
    select coalesce(sum(ra.amount_idr), 0) into v_reserved from public.refund_attempts ra
    where ra.payment_id = p_payment_id and ra.state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    insert into public.refund_attempts(payment_id, amount_idr, idempotency_key, refund_key, reason, actor_id, claim_token, claimed_at)
    values (p_payment_id, p_amount_idr, p_idempotency_key,
      'refund-' || left(encode(digest(p_payment_id::text || ':' || p_idempotency_key::text, 'sha256'), 'hex'), 40),
      trim(p_reason), p_actor_id, v_token, timezone('utc', now())) returning * into v_attempt;
  end if;
  attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr; provider_order_id := v_payment.provider_order_id;
  refund_key := v_attempt.refund_key; attempt_state := v_attempt.state; claim_token := v_attempt.claim_token;
  already_confirmed := false; return next;
end;
$$;

-- Functions created after the initial allowlist need explicit runtime grants.
grant execute on function public.mark_provider_refund_notification(uuid, text, jsonb) to postaichan_runtime;
grant execute on function public.resolve_provider_reconciliation_alert(uuid, uuid, text) to postaichan_runtime;
