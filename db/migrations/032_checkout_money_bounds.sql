-- Replaces checkout with numeric intermediates so arithmetic cannot overflow
-- PostgreSQL integer types before the 2,000,000,000 IDR domain limit is checked.
drop function if exists public.create_checkout_intent(uuid, text, text, uuid, uuid, public.payment_method, jsonb);

create function public.create_checkout_intent(
  p_idempotency_key uuid,
  p_idempotency_fingerprint text,
  p_session_hash text,
  p_table_id uuid,
  p_actor_id uuid,
  p_payment_method public.payment_method,
  p_items jsonb
) returns table(order_id uuid, order_number text, payment_id uuid, payment_status public.payment_status, amount_idr integer, provider_order_id text, qr_string text, created_at timestamptz, expires_at timestamptz, replayed boolean)
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
  v_unit_price numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_cost numeric := 0;
  v_tax numeric := 0;
  v_service_charge numeric := 0;
  v_total numeric := 0;
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
  if p_payment_method = 'qris' and not coalesce((select rs.qris_enabled from public.restaurant_settings rs order by rs.created_at asc limit 1), false) then raise exception 'QRIS_DISABLED'; end if;
  if p_payment_method = 'cash' and not coalesce((select rs.cash_enabled from public.restaurant_settings rs order by rs.created_at asc limit 1), false) then raise exception 'CASH_DISABLED'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where jsonb_typeof(item->'quantity') <> 'number'
       or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]?$'
  ) then raise exception 'INVALID_QUANTITY'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) item group by item->>'productId' having sum((item->>'quantity')::numeric) > 99) then raise exception 'INVALID_QUANTITY'; end if;
  if (select coalesce(sum((item->>'quantity')::numeric), 0) from jsonb_array_elements(p_items) item) > 500 then raise exception 'INVALID_QUANTITY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  perform public.release_expired_inventory_reservations();

  if p_session_hash is not null then
    select cs.* into v_session from public.customer_sessions cs where cs.access_token_hash = p_session_hash and cs.expires_at > timezone('utc', now()) for update;
    if not found then raise exception 'SESSION_EXPIRED'; end if;
    if v_session.source_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_session.source_table_id and rt.active = true and rt.qr_token_version = v_session.source_table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true and rt.qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
    if v_session.ordering_qr_code_id is not null and not exists (select 1 from public.ordering_qr_codes qr where qr.id = v_session.ordering_qr_code_id and qr.active = true and qr.token_version = v_session.ordering_qr_token_version) then raise exception 'QR_NOT_AVAILABLE'; end if;
  else
    v_table_id := p_table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
  end if;

  select * into v_order from public.orders where idempotency_key = p_idempotency_key::text for update;
  if found then
    if v_order.idempotency_fingerprint is distinct from p_idempotency_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_order.status in ('cancelled', 'refunded') then raise exception 'ORDER_NOT_RETRYABLE'; end if;
    select * into v_payment from public.payments p where p.order_id = v_order.id order by created_at desc limit 1 for update;
    if v_payment.status = 'pending' and v_payment.expires_at is not null and v_payment.expires_at <= timezone('utc', now()) then
      update public.payments set status = 'expired', last_provider_status = 'local_expiry', updated_at = timezone('utc', now()) where id = v_payment.id;
      perform public.release_inventory_reservation(v_payment.id, 'expired'::public.inventory_reservation_status);
      v_payment.status := 'expired';
    end if;
    if v_order.status in ('paid', 'accepted', 'processing', 'ready', 'completed', 'refunded') or v_payment.status in ('pending', 'settled', 'partially_refunded', 'refunded') then
      order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := v_payment.qr_string; created_at := v_payment.created_at; expires_at := v_payment.expires_at; replayed := true; return next; return;
    end if;
    v_expires := timezone('utc', now()) + interval '15 minutes';
    insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
    values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method, case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end, v_order.total_idr, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) else v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) end, case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end) returning * into v_payment;
    if p_payment_method = 'cash' then
      perform public.consume_inventory_reservation(v_payment.id);
      update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status = 'awaiting_payment';
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_order.total_idr));
    else
      perform public.reserve_order_inventory(v_order.id, v_payment.id, v_expires);
    end if;
    order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; created_at := v_payment.created_at; expires_at := v_payment.expires_at; replayed := true; return next; return;
  end if;
  if exists (select 1 from public.orders o join public.payments p on p.order_id = o.id where o.status = 'awaiting_payment' and p.status = 'pending' and p.expires_at > timezone('utc', now()) and ((p_session_hash is not null and o.customer_session_id = v_session.id) or (p_session_hash is null and o.created_by = p_actor_id))) then raise exception 'ACTIVE_PAYMENT_EXISTS'; end if;
  select coalesce(rs.tax_bps, 0), coalesce(rs.service_charge_bps, 0) into v_tax_bps, v_service_bps from public.restaurant_settings rs order by rs.created_at asc limit 1;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_item_quantity := (v_item->>'quantity')::integer;
    if v_item_quantity is null or v_item_quantity < 1 or v_item_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;
    select p.* into v_product from public.products p join public.categories c on c.id = p.category_id where p.id = v_product_id and p.active = true and p.available = true and p.archived_at is null and c.active = true for share of p;
    if not found then raise exception 'MENU_CONFLICT'; end if;
    if v_product.stock_tracked and v_product.stock_quantity <= 0 then raise exception 'STOCK_CONFLICT:%', v_product.name; end if;
    v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    perform 1 from public.variant_options where id = any(v_variant_ids) order by id for share;
    perform 1 from public.addon_options where id = any(v_addon_ids) order by id for share;
    if cardinality(v_variant_ids) <> (select count(distinct x) from unnest(v_variant_ids) as u(x)) then raise exception 'DUPLICATE_MODIFIER'; end if;
    select count(*) into v_modifier_count from public.variant_options vo join public.variant_groups vg on vg.id = vo.group_id and vg.active = true join public.product_variant_groups pvg on pvg.group_id = vg.id and pvg.product_id = v_product.id where vo.id = any(v_variant_ids) and vo.available = true;
    if v_modifier_count <> cardinality(v_variant_ids) then raise exception 'INVALID_MODIFIERS'; end if;
    select count(*) into v_modifier_count from public.addon_options ao join public.addon_groups ag on ag.id = ao.group_id and ag.active = true join public.product_addon_groups pag on pag.group_id = ag.id and pag.product_id = v_product.id where ao.id = any(v_addon_ids) and ao.available = true;
    if v_modifier_count <> (select count(distinct x) from unnest(v_addon_ids) as u(x)) then raise exception 'INVALID_MODIFIERS'; end if;
    for v_group in select vg.id, vg.required, vg.min_selection, vg.max_selection, vg.selection from public.variant_groups vg join public.product_variant_groups pvg on pvg.group_id = vg.id where pvg.product_id = v_product.id and vg.active = true
    loop
      select count(*) into v_group_count from public.variant_options where group_id = v_group.id and id = any(v_variant_ids);
      v_min := case when v_group.required then greatest(1, v_group.min_selection) else v_group.min_selection end;
      if v_group_count < v_min or v_group_count > v_group.max_selection or (v_group.selection = 'single' and v_group_count > 1) then raise exception 'INVALID_MODIFIERS'; end if;
    end loop;
    for v_group in select ag.id, ag.required, ag.min_selection, ag.max_selection from public.addon_groups ag join public.product_addon_groups pag on pag.group_id = ag.id where pag.product_id = v_product.id and ag.active = true
    loop
      select count(*) into v_group_count from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.group_id = v_group.id and ao.id = selected_id.id;
      v_min := case when v_group.required then greatest(1, v_group.min_selection) else v_group.min_selection end;
      if v_group_count < v_min or v_group_count > v_group.max_selection then raise exception 'INVALID_MODIFIERS'; end if;
    end loop;
    select v_product.price_idr::numeric + coalesce((select sum(price_adjustment_idr::numeric) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(ao.price_adjustment_idr::numeric) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0), v_product.estimated_cost_idr::numeric + coalesce((select sum(cost_adjustment_idr::numeric) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(ao.cost_adjustment_idr::numeric) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0) into v_unit_price, v_unit_cost;
    v_line_total := v_unit_price * v_item_quantity;
    if v_unit_price < 0 or v_unit_cost < 0 or v_unit_price > 2000000000 or v_unit_cost > 2000000000 or v_line_total < 0 or v_line_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
    v_subtotal := v_subtotal + v_line_total; v_cost := v_cost + (v_unit_cost * v_item_quantity);
    if v_subtotal > 2000000000 or v_cost > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  end loop;
  v_tax := floor((v_subtotal * v_tax_bps) / 10000 + 0.5); v_service_charge := floor((v_subtotal * v_service_bps) / 10000 + 0.5); v_total := v_subtotal + v_tax + v_service_charge;
  if v_total <= 0 or v_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  select public.next_order_number() into v_number;
  insert into public.orders(order_number, idempotency_key, idempotency_fingerprint, customer_session_id, table_id, order_type, status, subtotal_idr, discount_idr, tax_idr, service_charge_idr, total_idr, estimated_cost_idr, tax_bps_snapshot, service_charge_bps_snapshot, created_by) values (v_number, p_idempotency_key::text, p_idempotency_fingerprint, case when p_session_hash is null then null else v_session.id end, v_table_id, 'dine_in'::public.order_type, case when p_payment_method = 'cash' then 'paid'::public.order_status else 'awaiting_payment'::public.order_status end, v_subtotal, 0, v_tax, v_service_charge, v_total, v_cost, v_tax_bps, v_service_bps, p_actor_id) returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid; v_item_quantity := (v_item->>'quantity')::integer; v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]); v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    perform 1 from public.variant_options where id = any(v_variant_ids) order by id for share;
    perform 1 from public.addon_options where id = any(v_addon_ids) order by id for share;
    select p.* into v_product from public.products p where p.id = v_product_id;
    select v_product.price_idr::numeric + coalesce((select sum(price_adjustment_idr::numeric) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(ao.price_adjustment_idr::numeric) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0), v_product.estimated_cost_idr::numeric + coalesce((select sum(cost_adjustment_idr::numeric) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(ao.cost_adjustment_idr::numeric) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0) into v_unit_price, v_unit_cost;
    insert into public.order_items(order_id, product_id, product_name_snapshot, quantity, unit_price_idr, unit_cost_snapshot_idr, note, line_total_idr) values (v_order.id, v_product.id, v_product.name, v_item_quantity, v_unit_price, v_unit_cost, nullif(left(coalesce(v_item->>'note', ''), 240), ''), v_unit_price * v_item_quantity) returning id into v_item_id;
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'variant', vo.id, vo.name, vo.price_adjustment_idr, vo.cost_adjustment_idr from public.variant_options vo where vo.id = any(v_variant_ids);
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id;
  end loop;
  v_expires := timezone('utc', now()) + interval '15 minutes';
  insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at) values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method, case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end, v_total, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) else v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) end, case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end) returning * into v_payment;
  if p_payment_method = 'cash' then perform public.consume_inventory_reservation(v_payment.id); insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_total)); else perform public.reserve_order_inventory(v_order.id, v_payment.id, v_expires); end if;
  order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; created_at := v_payment.created_at; expires_at := v_payment.expires_at; replayed := false; return next;
end;
$$;
