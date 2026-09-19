-- A cash sale must not consume stock that is already reserved by another
-- payment attempt. The reservation being consumed is excluded from the
-- available-reservation calculation because its quantity is the current sale.
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

  select * into v_reservation
  from public.inventory_reservations
  where payment_id = p_payment_id
  for update;

  -- Cash payments create a short-lived ledger row immediately before
  -- consumption. QR payments must already have a reservation; a missing QR
  -- reservation is treated as an orphaned settlement rather than an
  -- unreserved sale.
  if not found and v_payment.method = 'cash' then
    insert into public.inventory_reservations(order_id, payment_id, status, expires_at)
    values (v_payment.order_id, v_payment.id, 'reserved', timezone('utc', now()) + interval '1 minute')
    returning * into v_reservation;
    insert into public.inventory_reservation_items(reservation_id, product_id, quantity)
    select v_reservation.id, oi.product_id, sum(oi.quantity)
    from public.order_items oi
    where oi.order_id = v_payment.order_id
    group by oi.product_id;
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
    select product_id
    from public.inventory_reservation_items
    where reservation_id = v_reservation.id
    order by product_id
  loop
    select p.* into v_product
    from public.products p
    where p.id = v_product_id
    for update;

    select quantity into v_quantity
    from public.inventory_reservation_items
    where reservation_id = v_reservation.id and product_id = v_product_id;

    if v_product.stock_tracked then
      select coalesce(sum(iri.quantity), 0) into v_other_reserved
      from public.inventory_reservation_items iri
      join public.inventory_reservations ir on ir.id = iri.reservation_id
      where iri.product_id = v_product_id
        and ir.id <> v_reservation.id
        and ir.status = 'reserved'
        and ir.expires_at > timezone('utc', now());

      if v_product.stock_quantity - v_other_reserved < v_quantity then
        raise exception 'STOCK_CONFLICT:%', v_product.name;
      end if;
      update public.products
      set stock_quantity = stock_quantity - v_quantity,
          updated_at = timezone('utc', now())
      where products.id = v_product_id;
    end if;
  end loop;

  update public.inventory_reservations
  set status = 'consumed',
      consumed_at = coalesce(consumed_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = v_reservation.id and status = 'reserved';
  return true;
end;
$$;
