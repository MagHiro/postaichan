-- RLS limits rows, not columns. Ordinary authenticated clients only need the
-- operational snapshot; cost, audit, provider and internal actor fields stay
-- behind server-authorized routes.
revoke select on public.order_items from authenticated;
grant select (id, order_id, product_id, product_name_snapshot, quantity, unit_price_idr, note, line_total_idr, created_at) on public.order_items to authenticated;
revoke select on public.order_item_modifiers from authenticated;
grant select (id, order_item_id, modifier_type, modifier_id, modifier_name_snapshot, price_adjustment_idr) on public.order_item_modifiers to authenticated;

revoke select on public.payments from authenticated;
grant select (id, order_id, provider, method, status, amount_idr, expires_at, settled_at, created_at, updated_at, refunded_amount_idr) on public.payments to authenticated;

revoke select on public.orders from authenticated;
grant select (id, order_number, customer_session_id, table_id, order_type, status, currency, subtotal_idr, discount_idr, tax_idr, service_charge_idr, total_idr, visit_reference, created_at, updated_at) on public.orders to authenticated;

revoke select on public.products from authenticated;
grant select (id, category_id, name, description, image_path, price_idr, available, active, display_order, archived_at, created_at, updated_at, popular, stock_tracked, stock_quantity) on public.products to authenticated;
