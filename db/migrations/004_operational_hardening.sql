-- Operational hardening for Tempat Taichan.
-- This migration is additive. It preserves order/payment snapshots and moves
-- stock, managed QR, staff, and audit invariants into PostgreSQL transactions.

create type public.ordering_qr_kind as enum ('general');
create type public.inventory_reservation_status as enum ('reserved', 'consumed', 'released', 'expired');
create type public.inventory_adjustment_type as enum ('initial_stock', 'manual_set', 'sale_consumed');

alter table public.products add column if not exists stock_tracked boolean not null default false;
alter table public.products add column if not exists stock_quantity integer not null default 0;
alter table public.products add column if not exists archived_available boolean;
alter table public.customer_sessions add column if not exists ordering_qr_code_id uuid;
alter table public.customer_sessions add column if not exists ordering_qr_token_version integer;

update public.products
set image_path = null
where image_path is not null
  and image_path !~ '^/uploads/menu/[A-Za-z0-9_-]+\\.webp$';

alter table public.products drop constraint if exists products_stock_quantity_check;
alter table public.products add constraint products_stock_quantity_check check (stock_quantity >= 0);
alter table public.products drop constraint if exists products_image_path_check;
alter table public.products add constraint products_image_path_check
  check (image_path is null or image_path ~ '^/uploads/menu/[A-Za-z0-9_-]+\\.webp$');
alter table public.customer_sessions
  drop constraint if exists customer_sessions_ordering_qr_reference_check;
alter table public.customer_sessions add constraint customer_sessions_ordering_qr_reference_check
  check ((ordering_qr_code_id is null and ordering_qr_token_version is null)
    or (ordering_qr_code_id is not null and ordering_qr_token_version is not null));

create table if not exists public.ordering_qr_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 1 and 80),
  kind public.ordering_qr_kind not null default 'general',
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_version integer not null default 1 check (token_version > 0),
  active boolean not null default true,
  created_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.customer_sessions
  add constraint customer_sessions_ordering_qr_fk
  foreign key (ordering_qr_code_id) references public.ordering_qr_codes(id);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  status public.inventory_reservation_status not null default 'reserved',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (payment_id)
);

create table if not exists public.inventory_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.inventory_reservations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  unique (reservation_id, product_id)
);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  previous_quantity integer not null check (previous_quantity >= 0),
  new_quantity integer not null check (new_quantity >= 0),
  delta integer generated always as (new_quantity - previous_quantity) stored,
  adjustment_type public.inventory_adjustment_type not null,
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  actor_id uuid references public.staff_users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_idr integer not null check (amount_idr > 0),
  refund_key text not null unique,
  reason text not null check (char_length(trim(reason)) between 3 and 240),
  actor_id uuid not null references public.staff_users(id),
  processed_at timestamptz not null default timezone('utc', now())
);

create index if not exists ordering_qr_codes_active_idx on public.ordering_qr_codes(active, updated_at desc);
create index if not exists inventory_reservations_active_idx on public.inventory_reservations(status, expires_at);
create index if not exists inventory_reservations_order_idx on public.inventory_reservations(order_id, created_at desc);
create index if not exists inventory_reservation_items_product_idx on public.inventory_reservation_items(product_id);
create index if not exists inventory_adjustments_product_idx on public.inventory_adjustments(product_id, created_at desc);
create index if not exists payment_refunds_processed_idx on public.payment_refunds(processed_at desc);
create index if not exists payment_refunds_payment_idx on public.payment_refunds(payment_id, processed_at desc);

create trigger ordering_qr_codes_updated_at before update on public.ordering_qr_codes for each row execute procedure public.set_updated_at();
create trigger inventory_reservations_updated_at before update on public.inventory_reservations for each row execute procedure public.set_updated_at();
-- Authenticated clients only receive operational columns. Financial snapshots,
-- provider fees, QR secrets, audit records, and arbitrary staff profiles stay
-- server-side behind explicit application authorization.
create or replace function public.is_admin_actor(p_actor_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor_id is not null and exists (
    select 1 from public.profiles where id = p_actor_id and active = true and role = 'admin'
  );
$$;

create or replace function public.is_staff_actor(p_actor_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor_id is not null and exists (
    select 1 from public.profiles where id = p_actor_id and active = true
  );
$$;

create or replace function public.release_expired_inventory_reservations()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.inventory_reservations
  set status = 'expired', released_at = coalesce(released_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where status = 'reserved' and expires_at <= timezone('utc', now());
  get diagnostics v_count = row_count;
  update public.payments
  set status = 'expired', last_provider_status = coalesce(last_provider_status, 'local_expiry'), updated_at = timezone('utc', now())
  where status = 'pending' and expires_at is not null and expires_at <= timezone('utc', now());
  return v_count;
end;
$$;

create or replace function public.reserve_order_inventory(p_order_id uuid, p_payment_id uuid, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_reservation_id uuid;
  v_product_id uuid;
  v_product public.products%rowtype;
  v_requested integer;
  v_reserved integer;
begin
  if p_order_id is null or p_payment_id is null or p_expires_at is null then raise exception 'INVALID_RESERVATION'; end if;
  perform public.release_expired_inventory_reservations();
  for v_product_id in
    select oi.product_id from public.order_items oi where oi.order_id = p_order_id group by oi.product_id order by oi.product_id
  loop
    select * into v_product from public.products where id = v_product_id for update;
    if not found then raise exception 'MENU_CONFLICT'; end if;
    v_requested := (select coalesce(sum(quantity), 0) from public.order_items where order_id = p_order_id and product_id = v_product_id);
    if v_product.stock_tracked then
      select coalesce(sum(iri.quantity), 0) into v_reserved
      from public.inventory_reservation_items iri
      join public.inventory_reservations ir on ir.id = iri.reservation_id
      where iri.product_id = v_product_id and ir.status = 'reserved' and ir.expires_at > timezone('utc', now());
      if v_product.stock_quantity - v_reserved < v_requested then
        raise exception 'STOCK_CONFLICT:%', v_product.name;
      end if;
    end if;
  end loop;
  insert into public.inventory_reservations(order_id, payment_id, status, expires_at)
  values (p_order_id, p_payment_id, 'reserved', p_expires_at)
  returning id into v_reservation_id;
  insert into public.inventory_reservation_items(reservation_id, product_id, quantity)
  select v_reservation_id, oi.product_id, sum(oi.quantity)
  from public.order_items oi where oi.order_id = p_order_id group by oi.product_id;
  return v_reservation_id;
end;
$$;

create or replace function public.release_inventory_reservation(p_payment_id uuid, p_status public.inventory_reservation_status default 'released')
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_updated integer;
begin
  if p_status not in ('released', 'expired') then raise exception 'INVALID_RESERVATION_STATUS'; end if;
  update public.inventory_reservations
  set status = p_status, released_at = coalesce(released_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where payment_id = p_payment_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.consume_inventory_reservation(p_payment_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_product_id uuid;
  v_product public.products%rowtype;
  v_quantity integer;
begin
  select * into v_reservation from public.inventory_reservations where payment_id = p_payment_id for update;
  if not found then return false; end if;
  if v_reservation.status = 'consumed' then return true; end if;
  if v_reservation.status <> 'reserved' or v_reservation.expires_at <= timezone('utc', now()) then
    if v_reservation.status = 'reserved' then perform public.release_inventory_reservation(p_payment_id, 'expired'); end if;
    return false;
  end if;
  for v_product_id in
    select product_id from public.inventory_reservation_items where reservation_id = v_reservation.id order by product_id
  loop
    select * into v_product from public.products where id = v_product_id for update;
    select quantity into v_quantity from public.inventory_reservation_items where reservation_id = v_reservation.id and product_id = v_product_id;
    if v_product.stock_tracked then
      if v_product.stock_quantity < v_quantity then raise exception 'STOCK_CONFLICT:%', v_product.name; end if;
      update public.products set stock_quantity = stock_quantity - v_quantity, updated_at = timezone('utc', now()) where id = v_product_id;
    end if;
  end loop;
  update public.inventory_reservations
  set status = 'consumed', consumed_at = coalesce(consumed_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where id = v_reservation.id and status = 'reserved';
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
) returns table(
  order_id uuid,
  order_number text,
  payment_id uuid,
  payment_status public.payment_status,
  amount_idr integer,
  provider_order_id text,
  qr_string text,
  expires_at timestamptz,
  replayed boolean
)
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
  v_note text;
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
    select * into v_session from public.customer_sessions where access_token_hash = p_session_hash and expires_at > timezone('utc', now()) for update;
    if not found then raise exception 'SESSION_EXPIRED'; end if;
    if v_session.order_type <> p_order_type then raise exception 'ORDER_TYPE_CONFLICT'; end if;
    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables where id = v_table_id and active = true and qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
    if v_session.ordering_qr_code_id is not null and not exists (select 1 from public.ordering_qr_codes where id = v_session.ordering_qr_code_id and active = true and token_version = v_session.ordering_qr_token_version) then raise exception 'QR_NOT_AVAILABLE'; end if;
  else
    v_table_id := p_table_id;
    if p_order_type = 'dine_in' and v_table_id is not null and not exists (select 1 from public.restaurant_tables where id = v_table_id and active = true) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
  end if;
  if p_order_type = 'takeaway' and v_table_id is not null then raise exception 'TAKEAWAY_TABLE_CONFLICT'; end if;

  select * into v_order from public.orders where idempotency_key = p_idempotency_key::text for update;
  if found then
    if v_order.idempotency_fingerprint is distinct from p_idempotency_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_order.status in ('cancelled', 'refunded') then raise exception 'ORDER_NOT_RETRYABLE'; end if;
    select * into v_payment from public.payments where order_id = v_order.id order by created_at desc limit 1 for update;
    if v_payment.status = 'pending' and v_payment.expires_at is not null and v_payment.expires_at <= timezone('utc', now()) then
      update public.payments set status = 'expired', last_provider_status = 'local_expiry', updated_at = timezone('utc', now()) where id = v_payment.id;
      perform public.release_inventory_reservation(v_payment.id, 'expired');
      v_payment.status := 'expired';
    end if;
    if v_order.status in ('paid', 'accepted', 'processing', 'ready', 'completed', 'refunded') or v_payment.status in ('pending', 'settled', 'partially_refunded', 'refunded') then
      order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := v_payment.qr_string; expires_at := v_payment.expires_at; replayed := true; return next; return;
    end if;
    v_expires := timezone('utc', now()) + interval '15 minutes';
    insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
    values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method,
      case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end,
      v_order.total_idr, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end,
      case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end)
    returning * into v_payment;
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
  select coalesce(tax_bps, 0), coalesce(service_charge_bps, 0) into v_tax_bps, v_service_bps from public.restaurant_settings order by created_at asc limit 1;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_item_quantity := (v_item->>'quantity')::integer;
    v_note := nullif(left(coalesce(v_item->>'note', ''), 240), '');
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
      select count(*) into v_group_count from public.addon_options where group_id = v_group.id and id = any(v_addon_ids);
      v_min := case when v_group.required then greatest(1, v_group.min_selection) else v_group.min_selection end;
      if v_group_count < v_min or v_group_count > v_group.max_selection then raise exception 'INVALID_MODIFIERS'; end if;
    end loop;
    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0), v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0) into v_unit_price, v_unit_cost;
    v_line_total := v_unit_price * v_item_quantity;
    if v_unit_price < 0 or v_unit_cost < 0 or v_line_total < 0 or v_line_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
    v_subtotal := v_subtotal + v_line_total;
    v_cost := v_cost + (v_unit_cost * v_item_quantity);
    if v_subtotal > 2000000000 or v_cost > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  end loop;
  v_tax := floor((v_subtotal * v_tax_bps)::numeric / 10000 + 0.5)::integer;
  v_service_charge := floor((v_subtotal * v_service_bps)::numeric / 10000 + 0.5)::integer;
  v_total := v_subtotal + v_tax + v_service_charge;
  if v_total <= 0 or v_total > 2000000000 then raise exception 'MONEY_LIMIT'; end if;
  select public.next_order_number() into v_number;
  insert into public.orders(order_number, idempotency_key, idempotency_fingerprint, customer_session_id, table_id, order_type, status, subtotal_idr, discount_idr, tax_idr, service_charge_idr, total_idr, estimated_cost_idr, tax_bps_snapshot, service_charge_bps_snapshot, created_by)
  values (v_number, p_idempotency_key::text, p_idempotency_fingerprint, case when p_session_hash is null then null else v_session.id end, v_table_id, p_order_type, case when p_payment_method = 'cash' then 'paid' else 'awaiting_payment' end, v_subtotal, 0, v_tax, v_service_charge, v_total, v_cost, v_tax_bps, v_service_bps, p_actor_id)
  returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_item_quantity := (v_item->>'quantity')::integer;
    v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    select p.* into v_product from public.products p where p.id = v_product_id;
    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0), v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0) into v_unit_price, v_unit_cost;
    insert into public.order_items(order_id, product_id, product_name_snapshot, quantity, unit_price_idr, unit_cost_snapshot_idr, note, line_total_idr)
    values (v_order.id, v_product.id, v_product.name, v_item_quantity, v_unit_price, v_unit_cost, nullif(left(coalesce(v_item->>'note', ''), 240), ''), v_unit_price * v_item_quantity) returning id into v_item_id;
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr)
      select v_item_id, 'variant', vo.id, vo.name, vo.price_adjustment_idr, vo.cost_adjustment_idr from public.variant_options vo where vo.id = any(v_variant_ids);
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr)
      select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from public.addon_options ao where ao.id = any(v_addon_ids);
  end loop;
  v_expires := timezone('utc', now()) + interval '15 minutes';
  insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
  values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method, case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end, v_total, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end, case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end) returning * into v_payment;
  if p_payment_method = 'cash' then
    perform public.consume_inventory_reservation(v_payment.id);
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_total));
  else
    perform public.reserve_order_inventory(v_order.id, v_payment.id, v_expires);
  end if;
  order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; expires_at := v_payment.expires_at; replayed := false; return next;
end;
$$;

create or replace function public.release_payment_provider_create(p_payment_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payments set provider_creation_claimed_at = null, provider_error = left(p_error, 240), status = 'failed', updated_at = timezone('utc', now()) where id = p_payment_id and status = 'pending';
  perform public.release_inventory_reservation(p_payment_id, 'released');
end;
$$;

create or replace function public.apply_payment_transition(
  p_payment_id uuid,
  p_next_status public.payment_status,
  p_provider_status text,
  p_provider_transaction_id text,
  p_fee_idr integer,
  p_settled_at timestamptz
) returns table(applied boolean, payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_current_rank integer;
  v_next_rank integer;
  v_consumed boolean;
begin
  if coalesce(p_fee_idr, 0) < 0 then raise exception 'INVALID_PAYMENT_FEE'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  v_current_rank := case v_payment.status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  v_next_rank := case p_next_status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  if v_payment.status <> p_next_status and (v_next_rank < v_current_rank or (v_payment.status in ('failed','expired') and p_next_status in ('failed','expired'))) then
    applied := false; payment_status := v_payment.status; order_status := v_order.status; return next; return;
  end if;
  if p_next_status = 'settled' and v_payment.status = 'pending' then
    if v_order.status in ('draft', 'awaiting_payment') then
      v_consumed := public.consume_inventory_reservation(v_payment.id);
      if v_consumed then
        update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status in ('draft','awaiting_payment');
        v_order.status := 'paid';
      end if;
    end if;
  elsif p_next_status in ('failed', 'expired') then
    perform public.release_inventory_reservation(v_payment.id, case when p_next_status = 'expired' then 'expired' else 'released' end);
  end if;
  update public.payments
  set status = p_next_status,
      last_provider_status = coalesce(p_provider_status, last_provider_status),
      provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
      fee_idr = greatest(v_payment.fee_idr, coalesce(p_fee_idr, v_payment.fee_idr)),
      settled_at = case when p_next_status = 'settled' then coalesce(v_payment.settled_at, p_settled_at, timezone('utc', now())) else v_payment.settled_at end,
      orphaned_settlement = case when p_next_status = 'settled' and (v_order.status not in ('paid','accepted','processing','ready','completed') or not exists (select 1 from public.inventory_reservations where payment_id = v_payment.id and status = 'consumed')) then true else orphaned_settlement end,
      provider_creation_claimed_at = null, provider_error = null, updated_at = timezone('utc', now())
  where id = v_payment.id;
  applied := true; payment_status := p_next_status; order_status := v_order.status; return next;
end;
$$;

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_expected_status public.order_status,
  p_next_status public.order_status,
  p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_updated integer;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if not exists (select 1 from (values ('paid'::order_status,'accepted'::order_status),('accepted','processing'),('processing','ready'),('ready','completed'),('draft','cancelled'),('awaiting_payment','cancelled')) as t(a,b) where t.a = p_expected_status and t.b = p_next_status) then return false; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> p_expected_status then return false; end if;
  if p_next_status in ('accepted','processing','ready','completed') and not exists (select 1 from public.payments where order_id = p_order_id and status in ('settled','partially_refunded','refunded') and orphaned_settlement = false) then return false; end if;
  update public.orders set status = p_next_status, updated_at = timezone('utc', now()) where id = p_order_id and status = p_expected_status;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    if p_next_status = 'cancelled' then
      update public.payments set status = 'expired', last_provider_status = 'cancelled_by_staff', updated_at = timezone('utc', now()) where order_id = p_order_id and status = 'pending';
      perform public.release_inventory_reservation(payment_id) from public.payments where order_id = p_order_id;
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'order_status_changed', 'order', p_order_id, jsonb_build_object('status', p_expected_status), jsonb_build_object('status', p_next_status));
  end if;
  return v_updated = 1;
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
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('settled','partially_refunded') then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  if v_payment.refund_claimed_amount_idr is distinct from p_amount_idr then raise exception 'REFUND_CLAIM_MISMATCH'; end if;
  v_refund_key := 'refund-' || v_payment.provider_order_id || '-' || (v_payment.refunded_amount_idr + p_amount_idr);
  if exists (select 1 from public.payment_refunds where refund_key = v_refund_key) then
    payment_status := v_payment.status; select status into order_status from public.orders where id = v_payment.order_id; return next; return;
  end if;
  v_refunded := v_payment.refunded_amount_idr + p_amount_idr;
  if p_amount_idr <= 0 or v_refunded > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  update public.payments set refunded_amount_idr = v_refunded, status = case when v_refunded = amount_idr then 'refunded'::payment_status else 'partially_refunded'::payment_status end, last_provider_status = 'refund', refund_claimed_at = null, refund_claimed_amount_idr = null, updated_at = timezone('utc', now()) where id = v_payment.id;
  insert into public.payment_refunds(payment_id, amount_idr, refund_key, reason, actor_id) values (v_payment.id, p_amount_idr, v_refund_key, left(p_reason, 240), p_actor_id);
  update public.orders set status = case when v_refunded = v_payment.amount_idr then 'refunded'::order_status else status end, updated_at = timezone('utc', now()) where id = v_order.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'payment_refunded', 'payment', v_payment.id, jsonb_build_object('refunded_amount_idr', v_payment.refunded_amount_idr), jsonb_build_object('refunded_amount_idr', v_refunded, 'order_id', v_order.id, 'reason', left(p_reason, 240)));
  payment_status := case when v_refunded = v_payment.amount_idr then 'refunded'::payment_status else 'partially_refunded'::payment_status end;
  order_status := case when v_refunded = v_payment.amount_idr then 'refunded'::order_status else v_order.status end;
  return next;
end;
$$;

create or replace function public.create_table_with_qr(p_label text, p_code text, p_active boolean, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  insert into public.restaurant_tables(label, code, active, qr_token_hash, qr_token_version) values (trim(p_label), upper(trim(p_code)), coalesce(p_active, true), p_token_hash, 1) returning * into v_table;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'table_created', 'restaurant_table', v_table.id, jsonb_build_object('label', v_table.label, 'code', v_table.code));
  id := v_table.id; label := v_table.label; code := v_table.code; active := v_table.active; qr_token_version := v_table.qr_token_version; return next;
end;
$$;

create or replace function public.update_table_metadata(p_table_id uuid, p_label text, p_code text, p_active boolean, p_actor_id uuid)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables%rowtype; v_old jsonb;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select * into v_table from public.restaurant_tables where id = p_table_id for update;
  if not found then return; end if;
  v_old := jsonb_build_object('label', v_table.label, 'code', v_table.code, 'active', v_table.active);
  update public.restaurant_tables set label = coalesce(trim(p_label), label), code = coalesce(upper(trim(p_code)), code), active = coalesce(p_active, active), updated_at = timezone('utc', now()) where id = p_table_id returning * into v_table;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'table_updated', 'restaurant_table', p_table_id, v_old, jsonb_build_object('label', v_table.label, 'code', v_table.code, 'active', v_table.active));
  id := v_table.id; label := v_table.label; code := v_table.code; active := v_table.active; qr_token_version := v_table.qr_token_version; return next;
end;
$$;

create or replace function public.rotate_table_qr(p_table_id uuid, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.restaurant_tables set qr_token_hash = p_token_hash, qr_token_version = qr_token_version + 1, updated_at = timezone('utc', now()) where restaurant_tables.id = p_table_id returning * into v_table;
  if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'table_qr_rotated', 'restaurant_table', p_table_id, jsonb_build_object('qr_token_version', v_table.qr_token_version));
  id := v_table.id; label := v_table.label; code := v_table.code; active := v_table.active; qr_token_version := v_table.qr_token_version; return next;
end;
$$;

create or replace function public.create_general_qr(p_label text, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, kind public.ordering_qr_kind, active boolean, token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_qr public.ordering_qr_codes%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  insert into public.ordering_qr_codes(label, kind, token_hash, token_version, active, created_by) values (trim(p_label), 'general', p_token_hash, 1, true, p_actor_id) returning * into v_qr;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'general_qr_created', 'ordering_qr_code', v_qr.id, jsonb_build_object('label', v_qr.label, 'token_version', v_qr.token_version));
  id := v_qr.id; label := v_qr.label; kind := v_qr.kind; active := v_qr.active; token_version := v_qr.token_version; return next;
end;
$$;

create or replace function public.update_general_qr(p_qr_id uuid, p_label text, p_active boolean, p_actor_id uuid)
returns table(id uuid, label text, kind public.ordering_qr_kind, active boolean, token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_qr public.ordering_qr_codes%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.ordering_qr_codes set label = coalesce(trim(p_label), label), active = coalesce(p_active, active), updated_at = timezone('utc', now()) where ordering_qr_codes.id = p_qr_id returning * into v_qr;
  if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'general_qr_updated', 'ordering_qr_code', p_qr_id, jsonb_build_object('label', v_qr.label, 'active', v_qr.active));
  id := v_qr.id; label := v_qr.label; kind := v_qr.kind; active := v_qr.active; token_version := v_qr.token_version; return next;
end;
$$;

create or replace function public.rotate_general_qr(p_qr_id uuid, p_token_hash text, p_actor_id uuid)
returns table(id uuid, label text, kind public.ordering_qr_kind, active boolean, token_version integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_qr public.ordering_qr_codes%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.ordering_qr_codes set token_hash = p_token_hash, token_version = token_version + 1, updated_at = timezone('utc', now()) where ordering_qr_codes.id = p_qr_id returning * into v_qr;
  if not found then return; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'general_qr_rotated', 'ordering_qr_code', p_qr_id, jsonb_build_object('token_version', v_qr.token_version));
  id := v_qr.id; label := v_qr.label; kind := v_qr.kind; active := v_qr.active; token_version := v_qr.token_version; return next;
end;
$$;

create or replace function public.provision_staff_profile(p_user_id uuid, p_display_name text, p_role public.staff_role, p_actor_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_profile public.profiles%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_user_id is null or char_length(trim(p_display_name)) not between 2 and 80 then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  insert into public.profiles(id, display_name, role, active) values (p_user_id, trim(p_display_name), coalesce(p_role, 'operator'), true) returning * into v_profile;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'staff_created', 'profile', p_user_id, jsonb_build_object('display_name', v_profile.display_name, 'role', v_profile.role, 'active', v_profile.active));
  return v_profile;
end;
$$;

create or replace function public.update_staff_profile(p_user_id uuid, p_active boolean, p_role public.staff_role, p_actor_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_profile public.profiles%rowtype; v_admin_count integer;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  if p_user_id = p_actor_id and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') then raise exception 'SELF_ADMIN_PROTECTION'; end if;
  select count(*) into v_admin_count from public.profiles where role = 'admin' and active = true;
  if v_profile.role = 'admin' and v_profile.active and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') and v_admin_count <= 1 then raise exception 'LAST_ACTIVE_ADMIN'; end if;
  update public.profiles set active = coalesce(p_active, active), role = coalesce(p_role, role), updated_at = timezone('utc', now()) where id = p_user_id returning * into v_profile;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'staff_updated', 'profile', p_user_id, jsonb_build_object('active', not (p_active is not null and p_active = v_profile.active), 'role', v_profile.role), jsonb_build_object('active', v_profile.active, 'role', v_profile.role));
  return v_profile;
end;
$$;

create or replace function public.create_product_with_audit(
  p_category_id uuid, p_name text, p_description text, p_image_path text, p_price_idr integer,
  p_estimated_cost_idr integer, p_available boolean, p_stock_tracked boolean, p_stock_quantity integer, p_actor_id uuid
) returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_product public.products%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_image_path is not null and p_image_path !~ '^/uploads/menu/[A-Za-z0-9_-]+\\.webp$' or coalesce(p_stock_quantity, 0) < 0 then raise exception 'INVALID_PRODUCT'; end if;
  if not exists (select 1 from public.categories where id = p_category_id and active = true) then raise exception 'CATEGORY_NOT_AVAILABLE'; end if;
  insert into public.products(category_id, name, description, image_path, price_idr, estimated_cost_idr, available, active, created_by, stock_tracked, stock_quantity)
  values (p_category_id, trim(p_name), nullif(trim(p_description), ''), p_image_path, p_price_idr, p_estimated_cost_idr, coalesce(p_available, true), true, p_actor_id, coalesce(p_stock_tracked, false), coalesce(p_stock_quantity, 0)) returning * into v_product;
  insert into public.inventory_adjustments(product_id, previous_quantity, new_quantity, adjustment_type, reason, actor_id) values (v_product.id, 0, v_product.stock_quantity, 'initial_stock', 'Stok awal produk', p_actor_id);
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'product_created', 'product', v_product.id, jsonb_build_object('name', v_product.name, 'category_id', v_product.category_id, 'price_idr', v_product.price_idr, 'stock_tracked', v_product.stock_tracked, 'stock_quantity', v_product.stock_quantity));
  return v_product;
end;
$$;

create or replace function public.update_product_with_audit(
  p_product_id uuid, p_category_id uuid, p_name text, p_description text, p_image_path text, p_price_idr integer,
  p_estimated_cost_idr integer, p_available boolean, p_stock_tracked boolean, p_stock_quantity integer, p_reason text, p_actor_id uuid
) returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_product public.products%rowtype; v_old public.products%rowtype; v_reserved integer;
begin
  if not public.is_admin_actor(p_actor_id) or p_image_path is not null and p_image_path !~ '^/uploads/menu/[A-Za-z0-9_-]+\\.webp$' or coalesce(p_stock_quantity, 0) < 0 then raise exception 'INVALID_PRODUCT'; end if;
  if not exists (select 1 from public.categories where id = p_category_id and active = true) then raise exception 'CATEGORY_NOT_AVAILABLE'; end if;
  select * into v_old from public.products where id = p_product_id and active = true for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if coalesce(p_stock_quantity, 0) <> v_old.stock_quantity then
    select coalesce(sum(iri.quantity), 0) into v_reserved from public.inventory_reservation_items iri join public.inventory_reservations ir on ir.id = iri.reservation_id where iri.product_id = p_product_id and ir.status = 'reserved' and ir.expires_at > timezone('utc', now());
    if coalesce(p_stock_quantity, 0) < v_reserved then raise exception 'STOCK_RESERVED'; end if;
  end if;
  update public.products set category_id = p_category_id, name = trim(p_name), description = nullif(trim(p_description), ''), image_path = p_image_path, price_idr = p_price_idr, estimated_cost_idr = p_estimated_cost_idr, available = coalesce(p_available, true), stock_tracked = coalesce(p_stock_tracked, false), stock_quantity = coalesce(p_stock_quantity, 0), updated_at = timezone('utc', now()) where id = p_product_id returning * into v_product;
  if v_old.stock_quantity <> v_product.stock_quantity then insert into public.inventory_adjustments(product_id, previous_quantity, new_quantity, adjustment_type, reason, actor_id) values (v_product.id, v_old.stock_quantity, v_product.stock_quantity, 'manual_set', left(coalesce(p_reason, 'Stok diperbarui'), 240), p_actor_id); end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'product_updated', 'product', p_product_id, jsonb_build_object('name', v_old.name, 'price_idr', v_old.price_idr, 'available', v_old.available, 'stock_tracked', v_old.stock_tracked, 'stock_quantity', v_old.stock_quantity, 'image_path', v_old.image_path), jsonb_build_object('name', v_product.name, 'price_idr', v_product.price_idr, 'available', v_product.available, 'stock_tracked', v_product.stock_tracked, 'stock_quantity', v_product.stock_quantity, 'image_path', v_product.image_path));
  return v_product;
end;
$$;

create or replace function public.archive_product(p_product_id uuid, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.products set archived_available = available, active = false, available = false, archived_at = coalesce(archived_at, timezone('utc', now())), updated_at = timezone('utc', now()) where id = p_product_id and active = true returning * into v_product;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'product_archived', 'product', p_product_id, jsonb_build_object('active', true, 'available', v_product.archived_available), jsonb_build_object('active', false, 'available', false, 'archived_at', v_product.archived_at));
  return true;
end;
$$;

create or replace function public.restore_product(p_product_id uuid, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  update public.products set active = true, available = coalesce(archived_available, true), archived_available = null, archived_at = null, updated_at = timezone('utc', now()) where id = p_product_id and active = false and archived_at is not null returning * into v_product;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'product_restored', 'product', p_product_id, jsonb_build_object('active', true, 'available', v_product.available));
  return true;
end;
$$;
