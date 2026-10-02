-- Modifier management: admin CRUD for variant/addon groups + options, and
-- per-product group assignments.
-- Customer ordering already reads these tables through public modifierGroups,
-- so exposing them here makes spice levels and add-ons editable from the menu
-- editor instead of seed-only data. Historical orders keep name/price snapshots
-- in public.order_item_modifiers, so edits never rewrite past orders.

create or replace function public.create_modifier_group(
  p_kind text, p_name text, p_selection text,
  p_required boolean, p_min_selection integer, p_max_selection integer,
  p_display_order integer, p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_selection public.modifier_selection;
  v_required boolean;
  v_min integer;
  v_max integer;
  v_order integer;
  v_id uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  if p_selection is not null and p_selection not in ('single', 'multiple') then raise exception 'INVALID_MODIFIER'; end if;
  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) not between 2 and 80 then raise exception 'INVALID_MODIFIER'; end if;
  v_selection := coalesce(p_selection::public.modifier_selection, 'single');
  if p_kind = 'addon' then v_selection := 'multiple'; end if;
  v_required := coalesce(p_required, false);
  v_min := coalesce(p_min_selection, 0);
  v_max := coalesce(p_max_selection, 1);
  v_order := coalesce(p_display_order, 0);
  if v_selection = 'single' then v_max := 1; end if;
  if v_required and v_min < 1 then v_min := 1; end if;
  if v_min < 0 or v_max < 1 or v_min > v_max or v_order < 0 or v_order > 1000000 then raise exception 'INVALID_MODIFIER'; end if;
  if p_kind = 'variant' then
    insert into public.variant_groups(name, selection, required, min_selection, max_selection, display_order, active)
    values (v_name, v_selection, v_required, v_min, v_max, v_order, true)
    returning id into v_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values (p_actor_id, 'modifier_group_created', 'variant_group', v_id, jsonb_build_object('name', v_name, 'selection', v_selection, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max));
  else
    insert into public.addon_groups(name, required, min_selection, max_selection, display_order, active)
    values (v_name, v_required, v_min, v_max, v_order, true)
    returning id into v_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values (p_actor_id, 'modifier_group_created', 'addon_group', v_id, jsonb_build_object('name', v_name, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max));
  end if;
  return v_id;
end;
$$;

create or replace function public.update_modifier_group(
  p_kind text, p_group_id uuid, p_name text, p_selection text,
  p_required boolean, p_min_selection integer, p_max_selection integer,
  p_display_order integer, p_active boolean, p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_old_name text;
  v_old jsonb;
  v_name text;
  v_selection public.modifier_selection;
  v_required boolean;
  v_min integer;
  v_max integer;
  v_order integer;
  v_active boolean;
  v_old_active boolean;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  if p_selection is not null and p_selection not in ('single', 'multiple') then raise exception 'INVALID_MODIFIER'; end if;
  if p_name is not null and char_length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_MODIFIER'; end if;
  if p_min_selection is not null and (p_min_selection < 0 or p_min_selection > 99) then raise exception 'INVALID_MODIFIER'; end if;
  if p_max_selection is not null and (p_max_selection < 1 or p_max_selection > 99) then raise exception 'INVALID_MODIFIER'; end if;
  if p_display_order is not null and (p_display_order < 0 or p_display_order > 1000000) then raise exception 'INVALID_MODIFIER'; end if;
  if p_kind = 'variant' then
    select vg.name, vg.selection, vg.required, vg.min_selection, vg.max_selection, vg.display_order, vg.active
      into v_old_name, v_selection, v_required, v_min, v_max, v_order, v_old_active
      from public.variant_groups vg where vg.id = p_group_id for update;
    if not found then return false; end if;
    v_old := jsonb_build_object('name', v_old_name, 'selection', v_selection, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max, 'display_order', v_order, 'active', v_old_active);
    v_name := coalesce(nullif(trim(p_name), ''), v_old_name);
    v_selection := coalesce(p_selection::public.modifier_selection, v_selection);
    v_required := coalesce(p_required, v_required);
    v_min := coalesce(p_min_selection, v_min);
    v_max := coalesce(p_max_selection, v_max);
    v_order := coalesce(p_display_order, v_order);
    v_active := coalesce(p_active, v_old_active);
    if v_selection = 'single' then v_max := 1; end if;
    if v_required and v_min < 1 then v_min := 1; end if;
    if v_min < 0 or v_max < 1 or v_min > v_max then raise exception 'INVALID_MODIFIER'; end if;
    if v_old_active = true and v_active = false
      and exists (select 1 from public.product_variant_groups pvg join public.products p on p.id = pvg.product_id where pvg.group_id = p_group_id and p.active = true)
    then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
    update public.variant_groups
    set name = v_name, selection = v_selection, required = v_required, min_selection = v_min, max_selection = v_max, display_order = v_order, active = v_active, updated_at = timezone('utc', now())
    where id = p_group_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'modifier_group_updated', 'variant_group', p_group_id, v_old, jsonb_build_object('name', v_name, 'selection', v_selection, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max, 'display_order', v_order, 'active', v_active));
    return true;
  else
    select ag.name, ag.required, ag.min_selection, ag.max_selection, ag.display_order, ag.active
      into v_old_name, v_required, v_min, v_max, v_order, v_old_active
      from public.addon_groups ag where ag.id = p_group_id for update;
    if not found then return false; end if;
    v_old := jsonb_build_object('name', v_old_name, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max, 'display_order', v_order, 'active', v_old_active);
    v_name := coalesce(nullif(trim(p_name), ''), v_old_name);
    v_required := coalesce(p_required, v_required);
    v_min := coalesce(p_min_selection, v_min);
    v_max := coalesce(p_max_selection, v_max);
    v_order := coalesce(p_display_order, v_order);
    v_active := coalesce(p_active, v_old_active);
    if v_required and v_min < 1 then v_min := 1; end if;
    if v_min < 0 or v_max < 1 or v_min > v_max then raise exception 'INVALID_MODIFIER'; end if;
    if v_old_active = true and v_active = false
      and exists (select 1 from public.product_addon_groups pag join public.products p on p.id = pag.product_id where pag.group_id = p_group_id and p.active = true)
    then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
    update public.addon_groups
    set name = v_name, required = v_required, min_selection = v_min, max_selection = v_max, display_order = v_order, active = v_active, updated_at = timezone('utc', now())
    where id = p_group_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'modifier_group_updated', 'addon_group', p_group_id, v_old, jsonb_build_object('name', v_name, 'required', v_required, 'min_selection', v_min, 'max_selection', v_max, 'display_order', v_order, 'active', v_active));
    return true;
  end if;
end;
$$;

create or replace function public.delete_modifier_group(p_kind text, p_group_id uuid, p_actor_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  if p_kind = 'variant' then
    if exists (select 1 from public.product_variant_groups pvg join public.products p on p.id = pvg.product_id where pvg.group_id = p_group_id and p.active = true) then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
    delete from public.variant_groups where id = p_group_id returning name into v_name;
    if not found then return false; end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value)
    values (p_actor_id, 'modifier_group_deleted', 'variant_group', p_group_id, jsonb_build_object('name', v_name));
    return true;
  else
    if exists (select 1 from public.product_addon_groups pag join public.products p on p.id = pag.product_id where pag.group_id = p_group_id and p.active = true) then raise exception 'MODIFIER_GROUP_IN_USE'; end if;
    delete from public.addon_groups where id = p_group_id returning name into v_name;
    if not found then return false; end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value)
    values (p_actor_id, 'modifier_group_deleted', 'addon_group', p_group_id, jsonb_build_object('name', v_name));
    return true;
  end if;
end;
$$;

create or replace function public.create_modifier_option(
  p_kind text, p_group_id uuid, p_name text,
  p_price_adjustment_idr integer, p_cost_adjustment_idr integer,
  p_available boolean, p_display_order integer, p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_price integer;
  v_cost integer;
  v_available boolean;
  v_order integer;
  v_id uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_MODIFIER'; end if;
  v_price := coalesce(p_price_adjustment_idr, 0);
  v_cost := coalesce(p_cost_adjustment_idr, 0);
  v_available := coalesce(p_available, true);
  v_order := coalesce(p_display_order, 0);
  if v_price < 0 or v_price > 100000000 or v_cost < 0 or v_cost > 100000000 or v_order < 0 or v_order > 1000000 then raise exception 'INVALID_MODIFIER'; end if;
  if p_kind = 'variant' then
    if not exists (select 1 from public.variant_groups where id = p_group_id) then raise exception 'INVALID_MODIFIER'; end if;
    insert into public.variant_options(group_id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order)
    values (p_group_id, v_name, v_price, v_cost, v_available, v_order)
    returning id into v_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values (p_actor_id, 'modifier_option_created', 'variant_option', v_id, jsonb_build_object('group_id', p_group_id, 'name', v_name, 'price_adjustment_idr', v_price));
  else
    if not exists (select 1 from public.addon_groups where id = p_group_id) then raise exception 'INVALID_MODIFIER'; end if;
    insert into public.addon_options(group_id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order)
    values (p_group_id, v_name, v_price, v_cost, v_available, v_order)
    returning id into v_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values (p_actor_id, 'modifier_option_created', 'addon_option', v_id, jsonb_build_object('group_id', p_group_id, 'name', v_name, 'price_adjustment_idr', v_price));
  end if;
  return v_id;
end;
$$;

create or replace function public.update_modifier_option(
  p_kind text, p_option_id uuid, p_name text,
  p_price_adjustment_idr integer, p_cost_adjustment_idr integer,
  p_available boolean, p_display_order integer, p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_old_name text;
  v_old jsonb;
  v_name text;
  v_price integer;
  v_cost integer;
  v_available boolean;
  v_order integer;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  if p_name is not null and char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_MODIFIER'; end if;
  if p_price_adjustment_idr is not null and (p_price_adjustment_idr < 0 or p_price_adjustment_idr > 100000000) then raise exception 'INVALID_MODIFIER'; end if;
  if p_cost_adjustment_idr is not null and (p_cost_adjustment_idr < 0 or p_cost_adjustment_idr > 100000000) then raise exception 'INVALID_MODIFIER'; end if;
  if p_display_order is not null and (p_display_order < 0 or p_display_order > 1000000) then raise exception 'INVALID_MODIFIER'; end if;
  if p_kind = 'variant' then
    select vo.name, vo.price_adjustment_idr, vo.cost_adjustment_idr, vo.available, vo.display_order
      into v_old_name, v_price, v_cost, v_available, v_order
      from public.variant_options vo where vo.id = p_option_id for update;
    if not found then return false; end if;
    v_old := jsonb_build_object('name', v_old_name, 'price_adjustment_idr', v_price, 'cost_adjustment_idr', v_cost, 'available', v_available, 'display_order', v_order);
    v_name := coalesce(nullif(trim(p_name), ''), v_old_name);
    v_price := coalesce(p_price_adjustment_idr, v_price);
    v_cost := coalesce(p_cost_adjustment_idr, v_cost);
    v_available := coalesce(p_available, v_available);
    v_order := coalesce(p_display_order, v_order);
    update public.variant_options
    set name = v_name, price_adjustment_idr = v_price, cost_adjustment_idr = v_cost, available = v_available, display_order = v_order
    where id = p_option_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'modifier_option_updated', 'variant_option', p_option_id, v_old, jsonb_build_object('name', v_name, 'price_adjustment_idr', v_price, 'cost_adjustment_idr', v_cost, 'available', v_available, 'display_order', v_order));
    return true;
  else
    select ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr, ao.available, ao.display_order
      into v_old_name, v_price, v_cost, v_available, v_order
      from public.addon_options ao where ao.id = p_option_id for update;
    if not found then return false; end if;
    v_old := jsonb_build_object('name', v_old_name, 'price_adjustment_idr', v_price, 'cost_adjustment_idr', v_cost, 'available', v_available, 'display_order', v_order);
    v_name := coalesce(nullif(trim(p_name), ''), v_old_name);
    v_price := coalesce(p_price_adjustment_idr, v_price);
    v_cost := coalesce(p_cost_adjustment_idr, v_cost);
    v_available := coalesce(p_available, v_available);
    v_order := coalesce(p_display_order, v_order);
    update public.addon_options
    set name = v_name, price_adjustment_idr = v_price, cost_adjustment_idr = v_cost, available = v_available, display_order = v_order
    where id = p_option_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_actor_id, 'modifier_option_updated', 'addon_option', p_option_id, v_old, jsonb_build_object('name', v_name, 'price_adjustment_idr', v_price, 'cost_adjustment_idr', v_cost, 'available', v_available, 'display_order', v_order));
    return true;
  end if;
end;
$$;

create or replace function public.delete_modifier_option(p_kind text, p_option_id uuid, p_actor_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_kind not in ('variant', 'addon') then raise exception 'INVALID_MODIFIER'; end if;
  -- Past orders keep name/price snapshots in public.order_item_modifiers, so a
  -- hard delete only affects future checkouts.
  if p_kind = 'variant' then
    delete from public.variant_options where id = p_option_id returning name into v_name;
    if not found then return false; end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value)
    values (p_actor_id, 'modifier_option_deleted', 'variant_option', p_option_id, jsonb_build_object('name', v_name));
    return true;
  else
    delete from public.addon_options where id = p_option_id returning name into v_name;
    if not found then return false; end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value)
    values (p_actor_id, 'modifier_option_deleted', 'addon_option', p_option_id, jsonb_build_object('name', v_name));
    return true;
  end if;
end;
$$;

create or replace function public.set_product_modifier_groups(
  p_product_id uuid, p_variant_ids uuid[], p_addon_ids uuid[], p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_variant_ids uuid[] := coalesce(p_variant_ids, '{}');
  v_addon_ids uuid[] := coalesce(p_addon_ids, '{}');
  v_old_variants uuid[];
  v_old_addons uuid[];
  v_count integer;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if coalesce(array_length(v_variant_ids, 1), 0) > 20 or coalesce(array_length(v_addon_ids, 1), 0) > 20 then raise exception 'INVALID_MODIFIER'; end if;
  if not exists (select 1 from public.products where id = p_product_id and active = true) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select count(distinct x) into v_count from unnest(v_variant_ids) as u(x);
  if v_count <> coalesce(array_length(v_variant_ids, 1), 0) then raise exception 'INVALID_MODIFIER'; end if;
  select count(distinct x) into v_count from unnest(v_addon_ids) as u(x);
  if v_count <> coalesce(array_length(v_addon_ids, 1), 0) then raise exception 'INVALID_MODIFIER'; end if;
  if coalesce(array_length(v_variant_ids, 1), 0) > 0 then
    select count(*) into v_count from public.variant_groups where id = any(v_variant_ids) and active = true;
    if v_count <> array_length(v_variant_ids, 1) then raise exception 'INVALID_MODIFIER'; end if;
  end if;
  if coalesce(array_length(v_addon_ids, 1), 0) > 0 then
    select count(*) into v_count from public.addon_groups where id = any(v_addon_ids) and active = true;
    if v_count <> array_length(v_addon_ids, 1) then raise exception 'INVALID_MODIFIER'; end if;
  end if;
  select coalesce(array_agg(pvg.group_id), '{}') into v_old_variants from public.product_variant_groups pvg where pvg.product_id = p_product_id;
  select coalesce(array_agg(pag.group_id), '{}') into v_old_addons from public.product_addon_groups pag where pag.product_id = p_product_id;
  delete from public.product_variant_groups where product_id = p_product_id;
  delete from public.product_addon_groups where product_id = p_product_id;
  insert into public.product_variant_groups(product_id, group_id) select p_product_id, x from unnest(v_variant_ids) as u(x) on conflict do nothing;
  insert into public.product_addon_groups(product_id, group_id) select p_product_id, x from unnest(v_addon_ids) as u(x) on conflict do nothing;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'product_modifiers_updated', 'product', p_product_id,
    jsonb_build_object('variant_group_ids', v_old_variants, 'addon_group_ids', v_old_addons),
    jsonb_build_object('variant_group_ids', v_variant_ids, 'addon_group_ids', v_addon_ids));
  return true;
end;
$$;
