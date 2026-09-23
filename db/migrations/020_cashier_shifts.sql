-- Cashier shifts: the register must be explicitly opened (with a full stock
-- intake for every tracked product) before any order can be created, and
-- explicitly closed. Closing produces a full recap scoped to the shift.
--
-- Ordering is gated by a BEFORE INSERT trigger on orders, so the rule holds
-- atomically for every path (customer QR checkout, POS cash, POS QR) without
-- rewriting create_checkout_intent. Replays insert no rows and keep working.

create table if not exists public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  opened_by uuid references public.staff_users(id),
  closed_by uuid references public.staff_users(id),
  opening_note text check (opening_note is null or char_length(trim(opening_note)) between 1 and 240),
  closing_note text check (closing_note is null or char_length(trim(closing_note)) between 1 and 240),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (closed_at is null or closed_at >= opened_at)
);

create table if not exists public.shift_stock_intakes (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cashier_shifts(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  opening_quantity integer not null check (opening_quantity >= 0 and opening_quantity <= 1000000),
  created_at timestamptz not null default timezone('utc', now()),
  unique (shift_id, product_id)
);

alter table public.orders add column if not exists shift_id uuid references public.cashier_shifts(id) on delete restrict;

create index if not exists cashier_shifts_open_idx on public.cashier_shifts(closed_at, opened_at desc);
create index if not exists shift_stock_intakes_shift_idx on public.shift_stock_intakes(shift_id, product_id);
create index if not exists orders_shift_idx on public.orders(shift_id);

create trigger cashier_shifts_updated_at before update on public.cashier_shifts for each row execute procedure public.set_updated_at();

-- Gate every new order on exactly one open shift and stamp it. Replays and
-- status transitions touch no new order row, so in-flight QRs keep settling
-- after close instead of being stranded.
create or replace function public.assert_shift_open_on_order()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_shift_id uuid;
begin
  select id into v_shift_id from public.cashier_shifts where closed_at is null order by opened_at desc limit 1 for update;
  if not found then raise exception 'SHIFT_CLOSED'; end if;
  new.shift_id := v_shift_id;
  return new;
end;
$$;

drop trigger if exists orders_require_open_shift on public.orders;
create trigger orders_require_open_shift before insert on public.orders
for each row execute procedure public.assert_shift_open_on_order();

-- Open the register. p_items is [{productId, quantity}] and must cover every
-- active tracked product: stock is always set on opening day, never carried
-- over silently. Quantities are set absolutely and logged as manual_set with
-- a shift reason so the close recap can reconcile intake vs sales.
create or replace function public.open_cashier_shift(
  p_actor_id uuid,
  p_note text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_shift_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product public.products%rowtype;
  v_old integer;
  v_missing text;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if v_note is not null and char_length(v_note) > 240 then raise exception 'INVALID_SHIFT_NOTE'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'INVALID_SHIFT_INTAKE'; end if;

  perform pg_advisory_xact_lock(hashtext('cashier_shift_open'));
  if exists (select 1 from public.cashier_shifts where closed_at is null) then raise exception 'SHIFT_ALREADY_OPEN'; end if;

  if (select count(*) from (select distinct (value->>'productId') from jsonb_array_elements(p_items)) distinct_ids)
    <> (select count(*) from jsonb_array_elements(p_items)) then raise exception 'INVALID_SHIFT_INTAKE'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_product_id is null or v_quantity is null or v_quantity < 0 or v_quantity > 1000000 then raise exception 'INVALID_SHIFT_INTAKE'; end if;
    select * into v_product from public.products where id = v_product_id and active = true for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if not v_product.stock_tracked then raise exception 'INVALID_SHIFT_INTAKE'; end if;
  end loop;

  select string_agg(p.name, ', ' order by p.name) into v_missing
  from public.products p
  where p.active = true and p.archived_at is null and p.stock_tracked = true
    and not exists (select 1 from jsonb_array_elements(p_items) item where (item->>'productId')::uuid = p.id);
  if v_missing is not null then raise exception 'SHIFT_INTAKE_INCOMPLETE:%', v_missing; end if;

  insert into public.cashier_shifts(opened_by, opening_note) values (p_actor_id, v_note) returning id into v_shift_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select stock_quantity into v_old from public.products where id = v_product_id;
    update public.products set stock_quantity = v_quantity, updated_at = timezone('utc', now()) where id = v_product_id;
    insert into public.shift_stock_intakes(shift_id, product_id, opening_quantity) values (v_shift_id, v_product_id, v_quantity);
    if v_old is distinct from v_quantity then
      insert into public.inventory_adjustments(product_id, previous_quantity, new_quantity, adjustment_type, reason, actor_id)
      values (v_product_id, coalesce(v_old, 0), v_quantity, 'manual_set', left('Stok awal shift ' || to_char(timezone('utc', now()) at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI'), 240), p_actor_id);
    end if;
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'shift_opened', 'cashier_shift', v_shift_id, jsonb_build_object('note', v_note, 'intake_rows', jsonb_array_length(p_items)));
  return v_shift_id;
end;
$$;

-- Close the register. Blocked while QR payments are still pending so money in
-- flight is never cut off from its shift. Settling keeps working after close
-- for QRs minted during the shift.
create or replace function public.close_cashier_shift(
  p_actor_id uuid,
  p_note text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_shift public.cashier_shifts%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_pending integer;
begin
  if not public.is_staff_actor(p_actor_id) then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
  if v_note is not null and char_length(v_note) > 240 then raise exception 'INVALID_SHIFT_NOTE'; end if;

  perform pg_advisory_xact_lock(hashtext('cashier_shift_open'));
  select * into v_shift from public.cashier_shifts where closed_at is null order by opened_at desc limit 1 for update;
  if not found then raise exception 'NO_OPEN_SHIFT'; end if;

  select count(*) into v_pending from public.payments where status = 'pending' and expires_at > timezone('utc', now());
  if v_pending > 0 then raise exception 'SHIFT_CLOSE_BLOCKED:%', v_pending; end if;

  update public.cashier_shifts set closed_at = timezone('utc', now()), closed_by = p_actor_id, closing_note = v_note, updated_at = timezone('utc', now()) where id = v_shift.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'shift_closed', 'cashier_shift', v_shift.id, jsonb_build_object('note', v_note));
  return v_shift.id;
end;
$$;
