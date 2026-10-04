-- Fix the menu image-path regex stored by 004_operational_hardening.sql.
-- That migration wrote the pattern with a doubled backslash
-- ('^/uploads/menu/[A-Za-z0-9_-]+\\.webp$'), which requires a literal
-- backslash before "webp". As a result no valid image path could ever match:
-- creating or editing any menu item with a photo raised INVALID_PRODUCT and
-- the admin API surfaced it as a 503. The corrected pattern uses a single
-- backslash escape for the literal dot.
-- This migration is additive and repairs the live constraint plus both
-- product write functions without touching existing rows (no product can
-- hold an image_path today, since the old pattern rejected every value).

alter table public.products drop constraint if exists products_image_path_check;
alter table public.products add constraint products_image_path_check
  check (image_path is null or image_path ~ '^/uploads/menu/[A-Za-z0-9_-]+\.webp$');

create or replace function public.create_product_with_audit(
  p_category_id uuid, p_name text, p_description text, p_image_path text, p_price_idr integer,
  p_estimated_cost_idr integer, p_available boolean, p_stock_tracked boolean, p_stock_quantity integer, p_actor_id uuid
) returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_product public.products%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) or p_image_path is not null and p_image_path !~ '^/uploads/menu/[A-Za-z0-9_-]+\.webp$' or coalesce(p_stock_quantity, 0) < 0 then raise exception 'INVALID_PRODUCT'; end if;
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
  if not public.is_admin_actor(p_actor_id) or p_image_path is not null and p_image_path !~ '^/uploads/menu/[A-Za-z0-9_-]+\.webp$' or coalesce(p_stock_quantity, 0) < 0 then raise exception 'INVALID_PRODUCT'; end if;
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
