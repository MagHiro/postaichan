-- Correctness fixes discovered by local PostgreSQL linting and cash-flow tests.

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
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then return false; end if;
  select * into v_reservation from public.inventory_reservations where payment_id = p_payment_id for update;
  -- Cash payments are consumed in the same checkout transaction. They do not
  -- need a payment window, so create the short-lived ledger row just before
  -- consuming it. QR payments must already have a reservation; a missing QR
  -- reservation is treated as an orphaned settlement instead of overselling.
  if not found and v_payment.method = 'cash' then
    insert into public.inventory_reservations(order_id, payment_id, status, expires_at)
    values (v_payment.order_id, v_payment.id, 'reserved', timezone('utc', now()) + interval '1 minute')
    returning * into v_reservation;
    insert into public.inventory_reservation_items(reservation_id, product_id, quantity)
    select v_reservation.id, oi.product_id, sum(oi.quantity)
    from public.order_items oi where oi.order_id = v_payment.order_id group by oi.product_id;
  elsif not found then
    return false;
  end if;
  if v_reservation.status = 'consumed' then return true; end if;
  if v_reservation.status <> 'reserved' or v_reservation.expires_at <= timezone('utc', now()) then
    if v_reservation.status = 'reserved' then perform public.release_inventory_reservation(p_payment_id, 'expired'::public.inventory_reservation_status); end if;
    return false;
  end if;
  for v_product_id in
    select product_id from public.inventory_reservation_items where reservation_id = v_reservation.id order by product_id
  loop
    select p.* into v_product from public.products p where p.id = v_product_id for update;
    select quantity into v_quantity from public.inventory_reservation_items where reservation_id = v_reservation.id and product_id = v_product_id;
    if v_product.stock_tracked then
      if v_product.stock_quantity < v_quantity then raise exception 'STOCK_CONFLICT:%', v_product.name; end if;
      update public.products set stock_quantity = stock_quantity - v_quantity, updated_at = timezone('utc', now()) where products.id = v_product_id;
    end if;
  end loop;
  update public.inventory_reservations set status = 'consumed', consumed_at = coalesce(consumed_at, timezone('utc', now())), updated_at = timezone('utc', now()) where id = v_reservation.id and status = 'reserved';
  return true;
end;
$$;

create or replace function public.create_checkout_intent(
  p_idempotency_key uuid,
  p_idempotency_fingerprint text,
  p_session_hash text,
  p_order_type public.order_type,
  p_table_id uuid,
  p_actor_id uuid,
  p_payment_method public.payment_method,
  p_items jsonb
) returns table(order_id uuid, order_number text, payment_id uuid, payment_status public.payment_status, amount_idr integer, provider_order_id text, qr_string text, expires_at timestamptz, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_session public.customer_sessions%rowtype;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_product public.products%rowtype;
  v_group record;
  v_item jsonb;
  v_product_id uuid;
  v_item_quantity integer;
  v_variant_ids uuid[];
  v_addon_ids uuid[];
  v_modifier_count integer;
  v_group_count integer;
  v_min integer;
  v_unit_price integer;
  v_unit_cost integer;
  v_line_total integer;
  v_subtotal integer := 0;
  v_cost integer := 0;
  v_tax integer := 0;
  v_service_charge integer := 0;
  v_total integer := 0;
  v_tax_bps integer := 0;
  v_service_bps integer := 0;
  v_table_id uuid;
  v_number text;
  v_item_id uuid;
  v_expires timestamptz;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'EMPTY_OR_LARGE_CART'; end if;
  if p_idempotency_key is null or p_idempotency_fingerprint is null or length(p_idempotency_fingerprint) > 128 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_session_hash is null and not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if p_session_hash is not null and p_payment_method = 'cash' then raise exception 'CASH_NOT_GUEST'; end if;
  if p_payment_method = 'qris' and not coalesce((select qris_enabled from public.restaurant_settings order by created_at asc limit 1), false) then raise exception 'QRIS_DISABLED'; end if;
  if p_payment_method = 'cash' and not coalesce((select cash_enabled from public.restaurant_settings order by created_at asc limit 1), false) then raise exception 'CASH_DISABLED'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) item group by item->>'productId' having sum((item->>'quantity')::integer) > 99) then raise exception 'INVALID_QUANTITY'; end if;
  if (select coalesce(sum((item->>'quantity')::integer), 0) from jsonb_array_elements(p_items) item) > 500 then raise exception 'INVALID_QUANTITY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  perform public.release_expired_inventory_reservations();

  if p_session_hash is not null then
    select cs.* into v_session from public.customer_sessions cs where cs.access_token_hash = p_session_hash and cs.expires_at > timezone('utc', now()) for update;
    if not found then raise exception 'SESSION_EXPIRED'; end if;
    if v_session.order_type <> p_order_type then raise exception 'ORDER_TYPE_CONFLICT'; end if;
    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true and rt.qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
    if v_session.ordering_qr_code_id is not null and not exists (select 1 from public.ordering_qr_codes qr where qr.id = v_session.ordering_qr_code_id and qr.active = true and qr.token_version = v_session.ordering_qr_token_version) then raise exception 'QR_NOT_AVAILABLE'; end if;
  else
    v_table_id := p_table_id;
    if p_order_type = 'dine_in' and v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
  end if;
  if p_order_type = 'takeaway' and v_table_id is not null then raise exception 'TAKEAWAY_TABLE_CONFLICT'; end if;

  select * into v_order from public.orders where idempotency_key = p_idempotency_key::text for update;
  if found then
    if v_order.idempotency_fingerprint is distinct from p_idempotency_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_order.status in ('cancelled', 'refunded') then raise exception 'ORDER_NOT_RETRYABLE'; end if;
    select * into v_payment from public.payments where order_id = v_order.id order by created_at desc limit 1 for update;
    if v_payment.status = 'pending' and v_payment.expires_at is not null and v_payment.expires_at <= timezone('utc', now()) then
      update public.payments set status = 'expired', last_provider_status = 'local_expiry', updated_at = timezone('utc', now()) where id = v_payment.id;
      perform public.release_inventory_reservation(v_payment.id, 'expired'::public.inventory_reservation_status);
      v_payment.status := 'expired';
    end if;
    if v_order.status in ('paid', 'accepted', 'processing', 'ready', 'completed', 'refunded') or v_payment.status in ('pending', 'settled', 'partially_refunded', 'refunded') then
      order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := v_payment.qr_string; expires_at := v_payment.expires_at; replayed := true; return next; return;
    end if;
    v_expires := timezone('utc', now()) + interval '15 minutes';
    insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
    values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method, case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end, v_order.total_idr, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end, case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end) returning * into v_payment;
    if p_payment_method = 'cash' then
      perform public.consume_inventory_reservation(v_payment.id);
      update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status = 'awaiting_payment';
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_order.total_idr));
    else
      perform public.reserve_order_inventory(v_order.id, v_payment.id, v_expires);
    end if;
    order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; expires_at := v_payment.expires_at; replayed := true; return next; return;
  end if;
  if exists (select 1 from public.orders o join public.payments p on p.order_id = o.id where o.status = 'awaiting_payment' and p.status = 'pending' and p.expires_at > timezone('utc', now()) and ((p_session_hash is not null and o.customer_session_id = v_session.id) or (p_session_hash is null and o.created_by = p_actor_id))) then raise exception 'ACTIVE_PAYMENT_EXISTS'; end if;
  select coalesce(rs.tax_bps, 0), coalesce(rs.service_charge_bps, 0) into v_tax_bps, v_service_bps from public.restaurant_settings rs order by rs.created_at asc limit 1;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_item_quantity := (v_item->>'quantity')::integer;
    if v_item_quantity is null or v_item_quantity < 1 or v_item_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;
    select p.* into v_product from public.products p join public.categories c on c.id = p.category_id where p.id = v_product_id and p.active = true and p.available = true and p.archived_at is null and c.active = true;
    if not found then raise exception 'MENU_CONFLICT'; end if;
    if v_product.stock_tracked and v_product.stock_quantity <= 0 then raise exception 'STOCK_CONFLICT:%', v_product.name; end if;
    v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    if cardinality(v_variant_ids) <> (select count(distinct x) from unnest(v_variant_ids) as u(x)) or cardinality(v_addon_ids) <> (select count(distinct x) from unnest(v_addon_ids) as u(x)) then raise exception 'DUPLICATE_MODIFIER'; end if;
    select count(*) into v_modifier_count from public.variant_options vo join public.variant_groups vg on vg.id = vo.group_id and vg.active = true join public.product_variant_groups pvg on pvg.group_id = vg.id and pvg.product_id = v_product.id where vo.id = any(v_variant_ids) and vo.available = true;
    if v_modifier_count <> cardinality(v_variant_ids) then raise exception 'INVALID_MODIFIERS'; end if;
    select count(*) into v_modifier_count from public.addon_options ao join public.addon_groups ag on ag.id = ao.group_id and ag.active = true join public.product_addon_groups pag on pag.group_id = ag.id and pag.product_id = v_product.id where ao.id = any(v_addon_ids) and ao.available = true;
    if v_modifier_count <> cardinality(v_addon_ids) then raise exception 'INVALID_MODIFIERS'; end if;
    for v_group in select vg.id, vg.required, vg.min_selection, vg.max_selection, vg.selection from public.variant_groups vg join public.product_variant_groups pvg on pvg.group_id = vg.id where pvg.product_id = v_product.id and vg.active = true
    loop
      select count(*) into v_group_count from public.variant_options where group_id = v_group.id and id = any(v_variant_ids);
      v_min := case when v_group.required then greatest(1, v_group.min_selection) else v_group.min_selection end;
      if v_group_count < v_min or v_group_count > v_group.max_selection or (v_group.selection = 'single' and v_group_count > 1) then raise exception 'INVALID_MODIFIERS'; end if;
    end loop;
    for v_group in select ag.id, ag.required, ag.min_selection, ag.max_selection from public.addon_groups ag join public.product_addon_groups pag on pag.group_id = ag.id where pag.product_id = v_product.id and ag.active = true
    loop
      select count(*) into v_group_count from public.addon_options where group_id = v_group.id;
      v_min := case when v_group.required then greatest(1, v_group.min_selection) else v_group.min_selection end;
      if v_group_count < v_min or v_group_count > v_group.max_selection then raise exception 'INVALID_MODIFIERS'; end if;
    end loop;
    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0), v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0) into v_unit_price, v_unit_cost;
    v_line_total := v_unit_price * v_item_quantity;
    if v_unit_price < 0 or v_unit_cost < 0 or v_line_total < 0 or v_line_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
    v_subtotal := v_subtotal + v_line_total; v_cost := v_cost + (v_unit_cost * v_item_quantity);
    if v_subtotal > 2000000000 or v_cost > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  end loop;
  v_tax := floor((v_subtotal * v_tax_bps)::numeric / 10000 + 0.5)::integer; v_service_charge := floor((v_subtotal * v_service_bps)::numeric / 10000 + 0.5)::integer; v_total := v_subtotal + v_tax + v_service_charge;
  if v_total <= 0 or v_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  select public.next_order_number() into v_number;
  insert into public.orders(order_number, idempotency_key, idempotency_fingerprint, customer_session_id, table_id, order_type, status, subtotal_idr, discount_idr, tax_idr, service_charge_idr, total_idr, estimated_cost_idr, tax_bps_snapshot, service_charge_bps_snapshot, created_by) values (v_number, p_idempotency_key::text, p_idempotency_fingerprint, case when p_session_hash is null then null else v_session.id end, v_table_id, p_order_type, case when p_payment_method = 'cash' then 'paid' else 'awaiting_payment' end, v_subtotal, 0, v_tax, v_service_charge, v_total, v_cost, v_tax_bps, v_service_bps, p_actor_id) returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid; v_item_quantity := (v_item->>'quantity')::integer; v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]); v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    select p.* into v_product from public.products p where p.id = v_product_id;
    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0), v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0) into v_unit_price, v_unit_cost;
    insert into public.order_items(order_id, product_id, product_name_snapshot, quantity, unit_price_idr, unit_cost_snapshot_idr, note, line_total_idr) values (v_order.id, v_product.id, v_product.name, v_item_quantity, v_unit_price, v_unit_cost, nullif(left(coalesce(v_item->>'note', ''), 240), ''), v_unit_price * v_item_quantity) returning id into v_item_id;
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'variant', vo.id, vo.name, vo.price_adjustment_idr, vo.cost_adjustment_idr from public.variant_options vo where vo.id = any(v_variant_ids);
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from public.addon_options ao where ao.id = any(v_addon_ids);
  end loop;
  v_expires := timezone('utc', now()) + interval '15 minutes';
  insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at) values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method, case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end, v_total, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end, case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end) returning * into v_payment;
  if p_payment_method = 'cash' then perform public.consume_inventory_reservation(v_payment.id); insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_total)); else perform public.reserve_order_inventory(v_order.id, v_payment.id, v_expires); end if;
  order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; expires_at := v_payment.expires_at; replayed := false; return next;
end;
$$;

create or replace function public.apply_payment_transition(p_payment_id uuid, p_next_status public.payment_status, p_provider_status text, p_provider_transaction_id text, p_fee_idr integer, p_settled_at timestamptz)
returns table(applied boolean, payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_current_rank integer; v_next_rank integer; v_consumed boolean;
begin
  select * into v_payment from public.payments where id = $1 for update; if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  v_current_rank := case v_payment.status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  v_next_rank := case $2 when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  if v_payment.status <> $2 and (v_next_rank < v_current_rank or (v_payment.status in ('failed','expired') and $2 in ('failed','expired'))) then applied := false; payment_status := v_payment.status; order_status := v_order.status; return next; return; end if;
  if $2 = 'settled' and v_payment.status = 'pending' and v_order.status in ('draft','awaiting_payment') then v_consumed := public.consume_inventory_reservation(v_payment.id); if v_consumed then update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status in ('draft','awaiting_payment'); v_order.status := 'paid'; end if; elsif $2 in ('failed','expired') then perform public.release_inventory_reservation(v_payment.id, case when $2 = 'expired' then 'expired'::public.inventory_reservation_status else 'released'::public.inventory_reservation_status end); end if;
  update public.payments set status = $2, last_provider_status = coalesce($3, last_provider_status), provider_transaction_id = coalesce($4, provider_transaction_id), fee_idr = greatest(v_payment.fee_idr, coalesce($5, v_payment.fee_idr)), settled_at = case when $2 = 'settled' then coalesce(v_payment.settled_at, $6, timezone('utc', now())) else v_payment.settled_at end, orphaned_settlement = case when $2 = 'settled' and (v_order.status not in ('paid','accepted','processing','ready','completed') or not exists (select 1 from public.inventory_reservations where payment_id = v_payment.id and status = 'consumed')) then true else orphaned_settlement end, provider_creation_claimed_at = null, provider_error = null, updated_at = timezone('utc', now()) where id = v_payment.id;
  applied := true; payment_status := $2; order_status := v_order.status; return next;
end;
$$;

create or replace function public.transition_order_status(p_order_id uuid, p_expected_status public.order_status, p_next_status public.order_status, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype; v_updated integer; v_payment_id uuid;
begin
  if not public.is_staff_actor($4) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if not exists (select 1 from (values ('paid'::order_status,'accepted'::order_status),('accepted','processing'),('processing','ready'),('ready','completed'),('draft','cancelled'),('awaiting_payment','cancelled')) as t(a,b) where t.a = $2 and t.b = $3) then return false; end if;
  select * into v_order from public.orders where id = $1 for update; if not found or v_order.status <> $2 then return false; end if;
  if $3 in ('accepted','processing','ready','completed') and not exists (select 1 from public.payments where order_id = $1 and status in ('settled','partially_refunded','refunded') and orphaned_settlement = false) then return false; end if;
  update public.orders set status = $3, updated_at = timezone('utc', now()) where id = $1 and status = $2; get diagnostics v_updated = row_count;
  if v_updated = 1 then
    if $3 = 'cancelled' then
      update public.payments set status = 'expired', last_provider_status = 'cancelled_by_staff', updated_at = timezone('utc', now()) where order_id = $1 and status = 'pending';
      for v_payment_id in select id from public.payments where order_id = $1 loop perform public.release_inventory_reservation(v_payment_id, 'released'::public.inventory_reservation_status); end loop;
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values ($4, 'order_status_changed', 'order', $1, jsonb_build_object('status', $2), jsonb_build_object('status', $3));
  end if;
  return v_updated = 1;
end;
$$;

create or replace function public.update_table_metadata(p_table_id uuid, p_label text, p_code text, p_active boolean, p_actor_id uuid)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables%rowtype; v_old jsonb;
begin
  if not public.is_admin_actor($5) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select rt.* into v_table from public.restaurant_tables rt where rt.id = $1 for update; if not found then return; end if;
  v_old := jsonb_build_object('label', v_table.label, 'code', v_table.code, 'active', v_table.active);
  update public.restaurant_tables rt set label = coalesce(trim($2), rt.label), code = coalesce(upper(trim($3)), rt.code), active = coalesce($4, rt.active), updated_at = timezone('utc', now()) where rt.id = $1 returning rt.* into v_table;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values ($5, 'table_updated', 'restaurant_table', $1, v_old, jsonb_build_object('label', v_table.label, 'code', v_table.code, 'active', v_table.active));
  id := v_table.id; label := v_table.label; code := v_table.code; active := v_table.active; qr_token_version := v_table.qr_token_version; return next;
end;
$$;

create or replace function public.rotate_table_qr(p_table_id uuid, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables%rowtype;
begin
  if not public.is_admin_actor($3) or $2 !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.restaurant_tables rt set qr_token_hash = $2, qr_token_version = rt.qr_token_version + 1, updated_at = timezone('utc', now()) where rt.id = $1 returning rt.* into v_table; if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values ($3, 'table_qr_rotated', 'restaurant_table', $1, jsonb_build_object('qr_token_version', v_table.qr_token_version));
  id := v_table.id; label := v_table.label; code := v_table.code; active := v_table.active; qr_token_version := v_table.qr_token_version; return next;
end;
$$;

create or replace function public.update_general_qr(p_qr_id uuid, p_label text, p_active boolean, p_actor_id uuid)
returns table(id uuid, label text, kind public.ordering_qr_kind, active boolean, token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_qr public.ordering_qr_codes%rowtype;
begin
  if not public.is_admin_actor($4) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.ordering_qr_codes qr set label = coalesce(trim($2), qr.label), active = coalesce($3, qr.active), updated_at = timezone('utc', now()) where qr.id = $1 returning qr.* into v_qr; if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values ($4, 'general_qr_updated', 'ordering_qr_code', $1, jsonb_build_object('label', v_qr.label, 'active', v_qr.active));
  id := v_qr.id; label := v_qr.label; kind := v_qr.kind; active := v_qr.active; token_version := v_qr.token_version; return next;
end;
$$;

create or replace function public.rotate_general_qr(p_qr_id uuid, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, kind public.ordering_qr_kind, active boolean, token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_qr public.ordering_qr_codes%rowtype;
begin
  if not public.is_admin_actor($3) or $2 !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.ordering_qr_codes qr set token_hash = $2, token_version = qr.token_version + 1, updated_at = timezone('utc', now()) where qr.id = $1 returning qr.* into v_qr; if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values ($3, 'general_qr_rotated', 'ordering_qr_code', $1, jsonb_build_object('token_version', v_qr.token_version));
  id := v_qr.id; label := v_qr.label; kind := v_qr.kind; active := v_qr.active; token_version := v_qr.token_version; return next;
end;
$$;
