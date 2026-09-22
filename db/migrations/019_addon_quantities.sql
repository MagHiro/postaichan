-- Add-on quantities are represented by repeated addonOptionIds entries in the
-- checkout payload. Keep the existing API shape while charging and snapshotting
-- each selected add-on unit instead of collapsing duplicate IDs.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  select pg_get_functiondef('public.create_checkout_intent(uuid,text,text,public.order_type,uuid,uuid,public.payment_method,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then raise exception 'create_checkout_intent_not_found'; end if;

  v_next := replace(
    v_definition,
    $$if cardinality(v_variant_ids) <> (select count(distinct x) from unnest(v_variant_ids) as u(x)) or cardinality(v_addon_ids) <> (select count(distinct x) from unnest(v_addon_ids) as u(x)) then raise exception 'DUPLICATE_MODIFIER'; end if;$$,
    $$if cardinality(v_variant_ids) <> (select count(distinct x) from unnest(v_variant_ids) as u(x)) then raise exception 'DUPLICATE_MODIFIER'; end if;$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_duplicate_check_not_found'; end if;

  v_definition := v_next;
  v_next := replace(
    v_definition,
    $$if v_modifier_count <> cardinality(v_addon_ids) then raise exception 'INVALID_MODIFIERS'; end if;$$,
    $$if v_modifier_count <> (select count(distinct x) from unnest(v_addon_ids) as u(x)) then raise exception 'INVALID_MODIFIERS'; end if;$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_validation_not_found'; end if;

  v_definition := v_next;
  v_next := replace(
    v_definition,
    $$coalesce((select sum(price_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0)$$,
    $$coalesce((select sum(ao.price_adjustment_idr) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0)$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_price_not_found'; end if;

  v_definition := v_next;
  v_next := replace(
    v_definition,
    $$coalesce((select sum(cost_adjustment_idr) from public.addon_options where id = any(v_addon_ids)), 0)$$,
    $$coalesce((select sum(ao.cost_adjustment_idr) from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id), 0)$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_cost_not_found'; end if;

  v_definition := v_next;
  v_next := replace(
    v_definition,
    $$select count(*) into v_group_count from public.addon_options where group_id = v_group.id and id = any(v_addon_ids);$$,
    $$select count(*) into v_group_count from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.group_id = v_group.id and ao.id = selected_id.id;$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_group_not_found'; end if;

  v_definition := v_next;
  v_next := replace(
    v_definition,
    $$insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from public.addon_options ao where ao.id = any(v_addon_ids);$$,
    $$insert into public.order_item_modifiers(order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr, cost_adjustment_snapshot_idr) select v_item_id, 'addon', ao.id, ao.name, ao.price_adjustment_idr, ao.cost_adjustment_idr from unnest(v_addon_ids) as selected_id(id) join public.addon_options ao on ao.id = selected_id.id;$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_snapshot_not_found'; end if;

  execute v_next;
end;
$migration$;
