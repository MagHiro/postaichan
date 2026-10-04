-- Per-product options: fork shared modifier groups so each product owns its copy.
-- After this, editing options for one product never affects another.
-- New groups created from the product editor are attached to a single product.
-- Past orders keep name/price snapshots in order_item_modifiers, so forking is safe.

do $fork$
declare
  r_group record;
  v_products uuid[];
  v_target uuid;
  v_new_group uuid;
begin
  -- Variant groups shared by multiple products -> duplicate per extra product.
  for r_group in
    select group_id, array_agg(product_id order by product_id) as products
    from public.product_variant_groups
    group by group_id having count(*) > 1
  loop
    v_products := r_group.products;
    for i in 2..array_length(v_products, 1) loop
      v_target := v_products[i];
      insert into public.variant_groups(name, selection, required, min_selection, max_selection, active, display_order)
      select name, selection, required, min_selection, max_selection, active, display_order
      from public.variant_groups where id = r_group.group_id
      returning id into v_new_group;
      insert into public.variant_options(group_id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order)
      select v_new_group, name, price_adjustment_idr, cost_adjustment_idr, available, display_order
      from public.variant_options where group_id = r_group.group_id;
      update public.product_variant_groups set group_id = v_new_group
      where product_id = v_target and group_id = r_group.group_id;
    end loop;
  end loop;

  -- Addon groups shared by multiple products -> duplicate per extra product.
  for r_group in
    select group_id, array_agg(product_id order by product_id) as products
    from public.product_addon_groups
    group by group_id having count(*) > 1
  loop
    v_products := r_group.products;
    for i in 2..array_length(v_products, 1) loop
      v_target := v_products[i];
      insert into public.addon_groups(name, required, min_selection, max_selection, active, display_order)
      select name, required, min_selection, max_selection, active, display_order
      from public.addon_groups where id = r_group.group_id
      returning id into v_new_group;
      insert into public.addon_options(group_id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order)
      select v_new_group, name, price_adjustment_idr, cost_adjustment_idr, available, display_order
      from public.addon_options where group_id = r_group.group_id;
      update public.product_addon_groups set group_id = v_new_group
      where product_id = v_target and group_id = r_group.group_id;
    end loop;
  end loop;
end;
$fork$;
