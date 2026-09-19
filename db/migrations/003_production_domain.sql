-- Production domain hardening. This migration is additive and preserves the
-- existing order/payment history. Apply it after 001_initial.sql and 002_relax_dine_in.sql.

alter table public.products add column if not exists popular boolean not null default false;
alter table public.orders add column if not exists tax_bps_snapshot integer not null default 0;
alter table public.orders add column if not exists service_charge_bps_snapshot integer not null default 0;
alter table public.orders add column if not exists idempotency_fingerprint text;
alter table public.payments add column if not exists provider_creation_claimed_at timestamptz;
alter table public.payments add column if not exists provider_created_at timestamptz;
alter table public.payments add column if not exists provider_error text;
alter table public.payments add column if not exists orphaned_settlement boolean not null default false;
alter table public.payments add column if not exists refunded_amount_idr integer not null default 0 check (refunded_amount_idr >= 0 and refunded_amount_idr <= amount_idr);
alter table public.payments add column if not exists refund_claimed_at timestamptz;
alter table public.payments add column if not exists refund_claimed_amount_idr integer;
alter table public.customer_sessions add column if not exists table_qr_version integer;

alter table public.orders drop constraint if exists orders_total_reconciliation_check;
alter table public.orders add constraint orders_total_reconciliation_check
  check (subtotal_idr + tax_idr + service_charge_idr - discount_idr = total_idr);
alter table public.orders drop constraint if exists orders_type_table_check;
alter table public.orders add constraint orders_type_table_check
  check (order_type = 'dine_in' or table_id is null);
alter table public.orders add constraint orders_money_upper_bound_check
  check (subtotal_idr <= 2000000000 and tax_idr <= 2000000000 and service_charge_idr <= 2000000000 and total_idr <= 2000000000);

create index if not exists payments_active_order_idx on public.payments(order_id, created_at desc);
create index if not exists customer_sessions_expiry_idx on public.customer_sessions(expires_at);
create index if not exists products_public_catalog_idx on public.products(active, available, archived_at, display_order);

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);
create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.rate_limit_buckets%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_bucket_key) > 200 then
    return false;
  end if;
  insert into public.rate_limit_buckets(bucket_key, window_started_at, request_count)
  values (p_bucket_key, timezone('utc', now()), 1)
  on conflict (bucket_key) do update
    set request_count = case
      when extract(epoch from (timezone('utc', now()) - rate_limit_buckets.window_started_at)) >= p_window_seconds then 1
      else rate_limit_buckets.request_count + 1
    end,
    window_started_at = case
      when extract(epoch from (timezone('utc', now()) - rate_limit_buckets.window_started_at)) >= p_window_seconds then timezone('utc', now())
      else rate_limit_buckets.window_started_at
    end,
    updated_at = timezone('utc', now())
  returning * into v_row;
  return v_row.request_count <= p_limit;
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
language plpgsql security definer set search_path = public
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'EMPTY_OR_LARGE_CART';
  end if;
  if p_session_hash is not null and p_payment_method = 'cash' then raise exception 'CASH_NOT_GUEST'; end if;
  if p_payment_method = 'qris' and not coalesce((select qris_enabled from public.restaurant_settings order by created_at asc limit 1), false) then raise exception 'QRIS_DISABLED'; end if;
  if p_payment_method = 'cash' and not coalesce((select cash_enabled from public.restaurant_settings order by created_at asc limit 1), false) then raise exception 'CASH_DISABLED'; end if;
  if p_idempotency_key is null or p_idempotency_fingerprint is null or length(p_idempotency_fingerprint) > 128 then
    raise exception 'INVALID_IDEMPOTENCY';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item->>'productId'
    having sum((item->>'quantity')::integer) > 99
  ) then raise exception 'INVALID_QUANTITY'; end if;
  if (select coalesce(sum((item->>'quantity')::integer), 0) from jsonb_array_elements(p_items) item) > 500 then raise exception 'INVALID_QUANTITY'; end if;

  -- Serialize every retry for the same logical intent before reading/inserting.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  if p_session_hash is not null then
    select * into v_session from public.customer_sessions
    where access_token_hash = p_session_hash and expires_at > timezone('utc', now())
    for update;
    if not found then raise exception 'SESSION_EXPIRED'; end if;
    if v_session.order_type <> p_order_type then raise exception 'ORDER_TYPE_CONFLICT'; end if;
    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables where id = v_table_id and active = true and qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
  else
    v_table_id := p_table_id;
    if p_order_type = 'dine_in' and v_table_id is not null and not exists (select 1 from public.restaurant_tables where id = v_table_id and active = true) then
      raise exception 'TABLE_NOT_AVAILABLE';
    end if;
  end if;
  if p_order_type = 'takeaway' and v_table_id is not null then raise exception 'TAKEAWAY_TABLE_CONFLICT'; end if;

  select * into v_order from public.orders where idempotency_key = p_idempotency_key::text for update;
  if found then
    if v_order.idempotency_fingerprint is not null and v_order.idempotency_fingerprint <> p_idempotency_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_order.status in ('cancelled', 'refunded') then
      raise exception 'ORDER_NOT_RETRYABLE';
    end if;
    select * into v_payment from public.payments where order_id = v_order.id order by created_at desc limit 1 for update;
    if v_payment.status = 'pending' and v_payment.expires_at is not null and v_payment.expires_at <= timezone('utc', now()) then
      update public.payments set status = 'expired', last_provider_status = 'local_expiry', updated_at = timezone('utc', now()) where id = v_payment.id;
      v_payment.status := 'expired';
    end if;
    if v_order.status in ('paid', 'accepted', 'processing', 'ready', 'completed', 'refunded') or v_payment.status in ('pending', 'settled', 'partially_refunded', 'refunded') then
      order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id;
      payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id;
      qr_string := v_payment.qr_string; expires_at := v_payment.expires_at; replayed := true; return next;
      return;
    end if;
    -- A failed/expired attempt is retained as history; a retry gets a new attempt on the same order.
    v_expires := timezone('utc', now()) + interval '15 minutes';
    insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
    values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method,
            case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end,
            v_order.total_idr, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end,
            case when p_payment_method = 'cash' then null else v_expires end,
            case when p_payment_method = 'cash' then timezone('utc', now()) else null end)
    returning * into v_payment;
    if p_payment_method = 'cash' then
      update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status = 'awaiting_payment';
    end if;
    order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id;
    payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id;
    qr_string := null; expires_at := v_payment.expires_at; replayed := true; return next;
    return;
  end if;

  -- One guest session may have only one live QR attempt. This prevents a
  -- customer from abandoning QR A, creating QR B, and fulfilling twice.
  update public.orders o set status = 'cancelled', updated_at = timezone('utc', now())
  where o.status = 'awaiting_payment'
    and (o.customer_session_id = v_session.id or (p_session_hash is null and o.created_by = p_actor_id))
    and exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'pending' and p.expires_at <= timezone('utc', now()));
  if exists (
    select 1 from public.orders o join public.payments p on p.order_id = o.id
    where o.status = 'awaiting_payment' and p.status = 'pending' and p.expires_at > timezone('utc', now())
      and (o.customer_session_id = v_session.id or (p_session_hash is null and o.created_by = p_actor_id))
  ) then raise exception 'ACTIVE_PAYMENT_EXISTS'; end if;

  select coalesce(tax_bps, 0), coalesce(service_charge_bps, 0) into v_tax_bps, v_service_bps
  from public.restaurant_settings order by created_at asc limit 1;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_item_quantity := (v_item->>'quantity')::integer;
    v_note := nullif(left(coalesce(v_item->>'note', ''), 240), '');
    if v_item_quantity is null or v_item_quantity < 1 or v_item_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;
    select p.* into v_product from public.products p join public.categories c on c.id = p.category_id
    where p.id = v_product_id and p.active = true and p.available = true and p.archived_at is null and c.active = true;
    if not found then raise exception 'MENU_CONFLICT'; end if;
    v_variant_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'variantOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    v_addon_ids := coalesce(array(select value::text::uuid from jsonb_array_elements_text(coalesce(v_item->'addonOptionIds', '[]'::jsonb))), '{}'::uuid[]);
    if cardinality(v_variant_ids) <> (select count(distinct x) from unnest(v_variant_ids) as u(x)) or cardinality(v_addon_ids) <> (select count(distinct x) from unnest(v_addon_ids) as u(x)) then raise exception 'DUPLICATE_MODIFIER'; end if;

    select count(*) into v_modifier_count from public.variant_options vo
      join public.variant_groups vg on vg.id = vo.group_id and vg.active = true
      join public.product_variant_groups pvg on pvg.group_id = vg.id and pvg.product_id = v_product.id
      where vo.id = any(v_variant_ids) and vo.available = true;
    if v_modifier_count <> cardinality(v_variant_ids) then raise exception 'INVALID_MODIFIERS'; end if;
    select count(*) into v_modifier_count from public.addon_options ao
      join public.addon_groups ag on ag.id = ao.group_id and ag.active = true
      join public.product_addon_groups pag on pag.group_id = ag.id and pag.product_id = v_product.id
      where ao.id = any(v_addon_ids) and ao.available = true;
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

    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0),
           v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0)
      into v_unit_price, v_unit_cost;
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
    select v_product.price_idr + coalesce((select sum(price_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0),
           v_product.estimated_cost_idr + coalesce((select sum(cost_adjustment_idr) from public.variant_options where id = any(v_variant_ids)), 0) + coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0)
      into v_unit_price, v_unit_cost;
    insert into public.order_items(order_id, product_id, product_name_snapshot, quantity, unit_price_idr, unit_cost_snapshot_idr, note, line_total_idr)
      values (v_order.id, v_product.id, v_product.name, v_item_quantity, v_unit_price, v_unit_cost, nullif(left(coalesce(v_item->>'note', ''), 240), ''), v_unit_price * v_item_quantity)
      returning id into v_item_id;
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr)
      select v_item_id, 'variant', vo.id, vo.name, vo.price_adjustment_idr, vo.cost_adjustment_idr from public.variant_options vo where vo.id = any(v_variant_ids);
    insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr)
      select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from public.addon_options ao where ao.id = any(v_addon_ids);
  end loop;
  v_expires := timezone('utc', now()) + interval '15 minutes';
  insert into public.payments(order_id, provider, method, status, amount_idr, provider_order_id, expires_at, settled_at)
  values (v_order.id, case when p_payment_method = 'cash' then 'cash' else 'midtrans' end, p_payment_method,
    case when p_payment_method = 'cash' then 'settled'::public.payment_status else 'pending'::public.payment_status end,
    v_total, case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end,
    case when p_payment_method = 'cash' then null else v_expires end, case when p_payment_method = 'cash' then timezone('utc', now()) else null end)
  returning * into v_payment;
  if p_payment_method = 'cash' then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value) values (p_actor_id, 'cash_payment_settled', 'order', v_order.id, jsonb_build_object('payment_id', v_payment.id, 'amount_idr', v_total));
  end if;
  order_id := v_order.id; order_number := v_order.order_number; payment_id := v_payment.id; payment_status := v_payment.status; amount_idr := v_payment.amount_idr; provider_order_id := v_payment.provider_order_id; qr_string := null; expires_at := v_payment.expires_at; replayed := false;
  return next;
end;
$$;

create or replace function public.claim_payment_provider_create(p_payment_id uuid)
returns boolean language sql security definer set search_path = public as $$
  update public.payments
  set provider_creation_claimed_at = timezone('utc', now())
  where id = p_payment_id and status = 'pending' and qr_string is null
    and (provider_creation_claimed_at is null or provider_creation_claimed_at < timezone('utc', now()) - interval '60 seconds')
  returning true;
$$;

create or replace function public.release_payment_provider_create(p_payment_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.payments set provider_creation_claimed_at = null, provider_error = left(p_error, 240), status = 'failed', updated_at = timezone('utc', now())
  where id = p_payment_id and status = 'pending';
$$;

create or replace function public.apply_payment_transition(
  p_payment_id uuid,
  p_next_status public.payment_status,
  p_provider_status text,
  p_provider_transaction_id text,
  p_fee_idr integer,
  p_settled_at timestamptz
) returns table(applied boolean, payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_current_rank integer;
  v_next_rank integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  v_current_rank := case v_payment.status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  v_next_rank := case p_next_status when 'pending' then 10 when 'failed' then 20 when 'expired' then 20 when 'settled' then 40 when 'partially_refunded' then 50 when 'refunded' then 60 end;
  if v_payment.status <> p_next_status and (v_next_rank < v_current_rank or (v_payment.status in ('failed','expired') and p_next_status in ('failed','expired'))) then
    applied := false; payment_status := v_payment.status; order_status := v_order.status; return next; return;
  end if;
  update public.payments set status = p_next_status, last_provider_status = coalesce(p_provider_status, last_provider_status), provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id), fee_idr = greatest(v_payment.fee_idr, coalesce(p_fee_idr, v_payment.fee_idr)), settled_at = case when p_next_status = 'settled' then coalesce(v_payment.settled_at, p_settled_at, timezone('utc', now())) else v_payment.settled_at end, orphaned_settlement = case when p_next_status = 'settled' and v_order.status not in ('draft','awaiting_payment') then true else orphaned_settlement end, provider_creation_claimed_at = null, provider_error = null, updated_at = timezone('utc', now()) where id = v_payment.id;
  if p_next_status = 'settled' and v_order.status in ('draft', 'awaiting_payment') then
    update public.orders set status = 'paid', updated_at = timezone('utc', now()) where id = v_order.id and status in ('draft','awaiting_payment');
    v_order.status := 'paid';
  end if;
  applied := true; payment_status := p_next_status; order_status := v_order.status; return next;
end;
$$;

create or replace function public.claim_payment_refund(p_payment_id uuid, p_amount_idr integer)
returns table(amount_idr integer, provider_order_id text, refund_key text)
language plpgsql security definer set search_path = public as $$
declare v_payment public.payments%rowtype; v_remaining integer; v_amount integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('settled','partially_refunded') then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  if v_payment.refund_claimed_at is not null and v_payment.refund_claimed_at > timezone('utc', now()) - interval '10 minutes' then raise exception 'REFUND_IN_PROGRESS'; end if;
  v_remaining := v_payment.amount_idr - v_payment.refunded_amount_idr;
  v_amount := coalesce(p_amount_idr, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  update public.payments set refund_claimed_at = timezone('utc', now()), refund_claimed_amount_idr = v_amount, updated_at = timezone('utc', now()) where id = v_payment.id;
  amount_idr := v_amount; provider_order_id := v_payment.provider_order_id; refund_key := 'refund-' || v_payment.provider_order_id || '-' || (v_payment.refunded_amount_idr + v_amount); return next;
end;
$$;

create or replace function public.apply_payment_refund(p_payment_id uuid, p_amount_idr integer, p_actor_id uuid, p_reason text)
returns table(payment_status public.payment_status, order_status public.order_status)
language plpgsql security definer set search_path = public as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_refunded integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  if v_payment.refund_claimed_amount_idr is distinct from p_amount_idr then raise exception 'REFUND_CLAIM_MISMATCH'; end if;
  v_refunded := v_payment.refunded_amount_idr + p_amount_idr;
  if v_refunded > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  update public.payments set refunded_amount_idr = v_refunded, status = case when v_refunded = amount_idr then 'refunded'::payment_status else 'partially_refunded'::payment_status end, last_provider_status = 'refund', refund_claimed_at = null, refund_claimed_amount_idr = null, updated_at = timezone('utc', now()) where id = v_payment.id;
  update public.orders set status = case when v_refunded = v_payment.amount_idr then 'refunded'::order_status else status end, updated_at = timezone('utc', now()) where id = v_order.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'payment_refunded', 'payment', v_payment.id, jsonb_build_object('refunded_amount_idr', v_payment.refunded_amount_idr), jsonb_build_object('refunded_amount_idr', v_refunded, 'order_id', v_order.id, 'reason', left(p_reason, 240)));
  payment_status := case when v_refunded = v_payment.amount_idr then 'refunded'::payment_status else 'partially_refunded'::payment_status end; order_status := case when v_refunded = v_payment.amount_idr then 'refunded'::order_status else v_order.status end; return next;
end;
$$;

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_expected_status public.order_status,
  p_next_status public.order_status,
  p_actor_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_updated integer;
begin
  if not exists (select 1 from (values ('draft'::order_status,'awaiting_payment'::order_status),('draft','cancelled'),('awaiting_payment','paid'),('awaiting_payment','cancelled'),('paid','accepted'),('accepted','processing'),('processing','ready'),('ready','completed')) as t(a,b) where t.a = p_expected_status and t.b = p_next_status) then return false; end if;
  update public.orders set status = p_next_status, updated_at = timezone('utc', now()) where id = p_order_id and status = p_expected_status;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value) values (p_actor_id, 'order_status_changed', 'order', p_order_id, jsonb_build_object('status', p_expected_status), jsonb_build_object('status', p_next_status)); end if;
  return v_updated = 1;
end;
$$;

create or replace function public.rotate_table_qr(p_table_id uuid, p_token_hash text)
returns table(id uuid, label text, code text, active boolean, qr_token_version integer)
language sql security definer set search_path = public as $$
  update public.restaurant_tables
  set qr_token_hash = p_token_hash, qr_token_version = qr_token_version + 1, updated_at = timezone('utc', now())
  where restaurant_tables.id = p_table_id
  returning restaurant_tables.id, restaurant_tables.label, restaurant_tables.code, restaurant_tables.active, restaurant_tables.qr_token_version;
$$;
