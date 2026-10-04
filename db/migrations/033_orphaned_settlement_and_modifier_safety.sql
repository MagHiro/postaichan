-- Enforce one owner per modifier group. Migration 024 already forks historical
-- shared groups; these indexes prevent future assignments from sharing them.
create unique index if not exists product_variant_groups_one_owner_idx on public.product_variant_groups(group_id);
create unique index if not exists product_addon_groups_one_owner_idx on public.product_addon_groups(group_id);

create or replace function public.assert_modifier_group_satisfiable(p_kind text, p_group_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_required boolean; v_min integer; v_max integer; v_selection public.modifier_selection;
  v_active boolean; v_available integer; v_needed integer;
begin
  if p_kind = 'variant' then
    select required, min_selection, max_selection, selection, active
      into v_required, v_min, v_max, v_selection, v_active from public.variant_groups where id = p_group_id;
    select count(*) into v_available from public.variant_options where group_id = p_group_id and available = true;
  elsif p_kind = 'addon' then
    select required, min_selection, max_selection, active
      into v_required, v_min, v_max, v_active from public.addon_groups where id = p_group_id;
    v_selection := 'multiple';
    select count(*) into v_available from public.addon_options where group_id = p_group_id and available = true;
  else raise exception 'INVALID_MODIFIER'; end if;
  if v_active is null then return; end if;
  v_needed := case when v_required then greatest(1, v_min) else v_min end;
  if v_selection = 'single' and v_needed > 1 then raise exception 'MODIFIER_GROUP_UNSATISFIABLE'; end if;
  if v_needed > v_max or (v_active = false and v_needed > 0 and exists (
    select 1 from public.products p
    join public.product_variant_groups a on a.product_id = p.id and a.group_id = p_group_id
    where p_kind = 'variant' and p.active = true
    union all
    select 1 from public.products p
    join public.product_addon_groups a on a.product_id = p.id and a.group_id = p_group_id
    where p_kind = 'addon' and p.active = true
  )) then raise exception 'MODIFIER_GROUP_UNSATISFIABLE'; end if;
  if v_active and exists (
    select 1 from public.products p join public.product_variant_groups a on a.product_id = p.id and a.group_id = p_group_id
    where p_kind = 'variant' and p.active = true
    union all
    select 1 from public.products p join public.product_addon_groups a on a.product_id = p.id and a.group_id = p_group_id
    where p_kind = 'addon' and p.active = true
  ) and v_available < v_needed then raise exception 'MODIFIER_GROUP_UNSATISFIABLE'; end if;
end;
$$;

create or replace function public.guard_modifier_group_configuration()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'variant_groups' then perform public.assert_modifier_group_satisfiable('variant', new.id);
  else perform public.assert_modifier_group_satisfiable('addon', new.id); end if;
  return new;
end;
$$;

drop trigger if exists variant_group_satisfiable on public.variant_groups;
create trigger variant_group_satisfiable after update on public.variant_groups
for each row execute function public.guard_modifier_group_configuration();
drop trigger if exists addon_group_satisfiable on public.addon_groups;
create trigger addon_group_satisfiable after update on public.addon_groups
for each row execute function public.guard_modifier_group_configuration();

create or replace function public.guard_modifier_option_availability()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_kind text; v_group_id uuid; v_other_available integer; v_needed integer; v_active boolean; v_min integer; v_required boolean; v_selection public.modifier_selection;
begin
  v_kind := case when tg_table_name = 'variant_options' then 'variant' else 'addon' end;
  v_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    if exists (select 1 from public.product_variant_groups where group_id = old.group_id) or exists (select 1 from public.product_addon_groups where group_id = old.group_id) then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
    if exists (select 1 from public.product_variant_groups where group_id = new.group_id) or exists (select 1 from public.product_addon_groups where group_id = new.group_id) then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
  end if;
  if tg_op = 'UPDATE' and old.available = new.available and old.group_id = new.group_id then return new; end if;
  if v_kind = 'variant' then
    select active, min_selection, required, selection into v_active, v_min, v_required, v_selection from public.variant_groups where id = v_group_id for update;
    select count(*) into v_other_available from public.variant_options where group_id = v_group_id and available = true
      and id <> case when tg_op = 'DELETE' then old.id else new.id end;
  else
    select active, min_selection, required into v_active, v_min, v_required from public.addon_groups where id = v_group_id for update;
    v_selection := 'multiple';
    select count(*) into v_other_available from public.addon_options where group_id = v_group_id and available = true
      and id <> case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  v_needed := case when v_required then greatest(1, v_min) else v_min end;
  if tg_op = 'UPDATE' and new.available then v_other_available := v_other_available + 1; end if;
  if v_active and exists (
    select 1 from public.products p join public.product_variant_groups a on a.product_id = p.id and a.group_id = v_group_id
    where v_kind = 'variant' and p.active = true
    union all
    select 1 from public.products p join public.product_addon_groups a on a.product_id = p.id and a.group_id = v_group_id
    where v_kind = 'addon' and p.active = true
  ) and (v_needed > v_other_available or (v_selection = 'single' and v_needed > 1)) then raise exception 'MODIFIER_GROUP_UNSATISFIABLE'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists variant_option_satisfiable on public.variant_options;
create trigger variant_option_satisfiable before update or delete on public.variant_options
for each row execute function public.guard_modifier_option_availability();
drop trigger if exists addon_option_satisfiable on public.addon_options;
create trigger addon_option_satisfiable before update or delete on public.addon_options
for each row execute function public.guard_modifier_option_availability();

create or replace function public.set_product_modifier_groups(
  p_product_id uuid, p_variant_ids uuid[], p_addon_ids uuid[], p_actor_id uuid
) returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_variant_ids uuid[] := coalesce(p_variant_ids, '{}'); v_addon_ids uuid[] := coalesce(p_addon_ids, '{}');
  v_old_variants uuid[]; v_old_addons uuid[]; v_count integer; v_group_id uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if coalesce(array_length(v_variant_ids, 1), 0) > 20 or coalesce(array_length(v_addon_ids, 1), 0) > 20 then raise exception 'INVALID_MODIFIER'; end if;
  if not exists (select 1 from public.products where id = p_product_id and active = true) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select count(distinct x) into v_count from unnest(v_variant_ids) as u(x);
  if v_count <> coalesce(array_length(v_variant_ids, 1), 0) then raise exception 'INVALID_MODIFIER'; end if;
  select count(distinct x) into v_count from unnest(v_addon_ids) as u(x);
  if v_count <> coalesce(array_length(v_addon_ids, 1), 0) then raise exception 'INVALID_MODIFIER'; end if;
  if exists (select 1 from public.product_variant_groups where group_id = any(v_variant_ids) and product_id <> p_product_id)
     or exists (select 1 from public.product_addon_groups where group_id = any(v_addon_ids) and product_id <> p_product_id) then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
  if exists (select 1 from unnest(v_variant_ids) x(id) where not exists (select 1 from public.variant_groups g where g.id = x.id and g.active))
     or exists (select 1 from unnest(v_addon_ids) x(id) where not exists (select 1 from public.addon_groups g where g.id = x.id and g.active)) then raise exception 'INVALID_MODIFIER'; end if;
  select coalesce(array_agg(group_id), '{}') into v_old_variants from public.product_variant_groups where product_id = p_product_id;
  select coalesce(array_agg(group_id), '{}') into v_old_addons from public.product_addon_groups where product_id = p_product_id;
  delete from public.product_variant_groups where product_id = p_product_id;
  delete from public.product_addon_groups where product_id = p_product_id;
  insert into public.product_variant_groups(product_id, group_id) select p_product_id, x from unnest(v_variant_ids) as u(x);
  insert into public.product_addon_groups(product_id, group_id) select p_product_id, x from unnest(v_addon_ids) as u(x);
  for v_group_id in select unnest(v_variant_ids) loop perform public.assert_modifier_group_satisfiable('variant', v_group_id); end loop;
  for v_group_id in select unnest(v_addon_ids) loop perform public.assert_modifier_group_satisfiable('addon', v_group_id); end loop;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'product_modifiers_updated', 'product', p_product_id,
    jsonb_build_object('variant_group_ids', v_old_variants, 'addon_group_ids', v_old_addons),
    jsonb_build_object('variant_group_ids', v_variant_ids, 'addon_group_ids', v_addon_ids));
  return true;
end;
$$;

create or replace function public.guard_product_modifier_activation()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_group_id uuid;
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    for v_group_id in select group_id from public.product_variant_groups where product_id = new.id loop perform public.assert_modifier_group_satisfiable('variant', v_group_id); end loop;
    for v_group_id in select group_id from public.product_addon_groups where product_id = new.id loop perform public.assert_modifier_group_satisfiable('addon', v_group_id); end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists product_modifier_activation_satisfiable on public.products;
create trigger product_modifier_activation_satisfiable before insert or update of active on public.products
for each row execute function public.guard_product_modifier_activation();

-- Safely consume released/expired reservations only when tracked stock still
-- covers the order after other live reservations are protected.
create or replace function public.consume_orphaned_settlement_inventory(p_payment_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_reservation public.inventory_reservations%rowtype;
  v_product_id uuid; v_product public.products%rowtype; v_quantity integer; v_reserved integer;
  v_reservation_id uuid; v_new_quantity integer; v_has_reservation boolean;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then return false; end if;
  select * into v_reservation from public.inventory_reservations where payment_id = p_payment_id for update;
  v_has_reservation := found;
  if v_has_reservation and v_reservation.status = 'consumed' then return true; end if;
  for v_product_id in select product_id from public.order_items where order_id = v_payment.order_id group by product_id order by product_id loop
    select * into v_product from public.products where id = v_product_id for update;
    select coalesce(sum(quantity),0) into v_quantity from public.order_items where order_id = v_payment.order_id and product_id = v_product_id;
    if v_product.stock_tracked then
      select coalesce(sum(iri.quantity),0) into v_reserved from public.inventory_reservation_items iri
      join public.inventory_reservations ir on ir.id = iri.reservation_id
      where iri.product_id = v_product_id and ir.payment_id <> p_payment_id and ir.status = 'reserved' and ir.expires_at > timezone('utc', now());
      if v_product.stock_quantity - v_reserved < v_quantity then return false; end if;
    end if;
  end loop;
  if not v_has_reservation then
    insert into public.inventory_reservations(order_id, payment_id, status, expires_at)
    values (v_payment.order_id, p_payment_id, 'reserved', timezone('utc', now()) + interval '1 minute') returning id into v_reservation_id;
    insert into public.inventory_reservation_items(reservation_id, product_id, quantity)
    select v_reservation_id, product_id, sum(quantity) from public.order_items where order_id = v_payment.order_id group by product_id;
    select * into v_reservation from public.inventory_reservations where id = v_reservation_id for update;
  elsif v_reservation.status <> 'reserved' then
    update public.inventory_reservations set status = 'reserved', expires_at = timezone('utc', now()) + interval '1 minute', released_at = null
    where id = v_reservation.id returning * into v_reservation;
  end if;
  for v_product_id in select product_id from public.inventory_reservation_items where reservation_id = v_reservation.id order by product_id loop
    select * into v_product from public.products where id = v_product_id for update;
    select quantity into v_quantity from public.inventory_reservation_items where reservation_id = v_reservation.id and product_id = v_product_id;
    if v_product.stock_tracked then
      v_new_quantity := v_product.stock_quantity - v_quantity;
      if v_new_quantity < 0 then return false; end if;
      update public.products set stock_quantity = v_new_quantity, updated_at = timezone('utc', now()) where id = v_product_id;
      insert into public.inventory_adjustments(product_id, previous_quantity, new_quantity, adjustment_type, reason, actor_id)
      values (v_product_id, v_product.stock_quantity, v_new_quantity, 'sale_consumed', 'Rekonsiliasi settlement terlambat', null);
    end if;
  end loop;
  update public.inventory_reservations set status = 'consumed', consumed_at = coalesce(consumed_at, timezone('utc', now())), expires_at = greatest(expires_at, timezone('utc', now())), updated_at = timezone('utc', now()) where id = v_reservation.id;
  return true;
end;
$$;

create or replace function public.reconcile_orphaned_settlement(
  p_payment_id uuid, p_action text, p_actor_id uuid, p_reason text
) returns table(resolved boolean, order_status public.order_status, payment_status public.payment_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype;
  v_old_order_status public.order_status;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_action <> 'accept' then raise exception 'REFUND_REQUIRES_DURABLE_WORKFLOW'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then raise exception 'INVALID_RECONCILIATION_REASON'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status <> 'settled' or not v_payment.orphaned_settlement then raise exception 'ORPHANED_SETTLEMENT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  v_old_order_status := v_order.status;
  if not public.consume_orphaned_settlement_inventory(v_payment.id) then raise exception 'ORPHANED_SETTLEMENT_STOCK_UNAVAILABLE'; end if;
  update public.payments set orphaned_settlement = false, updated_at = timezone('utc', now()) where id = v_payment.id;
  update public.orders set status = case when status in ('draft','awaiting_payment','cancelled') then 'paid'::public.order_status else status end,
    updated_at = timezone('utc', now()) where id = v_order.id returning * into v_order;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'orphaned_settlement_accepted', 'payment', v_payment.id,
    jsonb_build_object('orphaned_settlement', true, 'order_status', v_old_order_status),
    jsonb_build_object('orphaned_settlement', false, 'order_status', v_order.status, 'reason', trim(p_reason)));
  resolved := true; order_status := v_order.status; payment_status := v_payment.status; return next;
end;
$$;

create or replace function public.complete_orphaned_settlement_refund(p_payment_id uuid, p_actor_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment public.payments%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then raise exception 'INVALID_RECONCILIATION_REASON'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or not v_payment.orphaned_settlement or v_payment.status <> 'refunded' or v_payment.refunded_amount_idr <> v_payment.amount_idr then raise exception 'ORPHAN_REFUND_NOT_COMPLETE'; end if;
  update public.payments set orphaned_settlement = false, updated_at = timezone('utc', now()) where id = p_payment_id;
  update public.provider_reconciliation_alerts set state = 'resolved', resolution = left(trim(p_reason),240), resolved_by = p_actor_id, resolved_at = timezone('utc', now())
  where payment_id = p_payment_id and state = 'unresolved';
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'orphaned_settlement_refunded', 'payment', p_payment_id,
    jsonb_build_object('orphaned_settlement', true), jsonb_build_object('orphaned_settlement', false, 'refunded_amount_idr', v_payment.refunded_amount_idr, 'reason', trim(p_reason)));
  return true;
end;
$$;
