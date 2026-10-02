-- Category management: admin CRUD with audit trails.
-- Products already reference public.categories(category_id); this adds
-- explicit server-side functions so categories are DB-driven instead of
-- hardcoded in the client. Deactivation is blocked while active products
-- reference the category to avoid silently hiding menu items.

create or replace function public.create_category(p_name text, p_description text, p_display_order integer, p_actor_id uuid)
returns table(id uuid, name text, description text, display_order integer, active boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_category public.categories%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_CATEGORY'; end if;
  if p_description is not null and char_length(trim(p_description)) > 500 then raise exception 'INVALID_CATEGORY'; end if;
  if coalesce(p_display_order, 0) < 0 or coalesce(p_display_order, 0) > 1000000 then raise exception 'INVALID_CATEGORY'; end if;
  insert into public.categories(name, description, display_order, active)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_display_order, 0), true)
  returning * into v_category;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'category_created', 'category', v_category.id, jsonb_build_object('name', v_category.name, 'display_order', v_category.display_order));
  id := v_category.id; name := v_category.name; description := v_category.description; display_order := v_category.display_order; active := v_category.active; return next;
end;
$$;

create or replace function public.update_category(p_category_id uuid, p_name text, p_description text, p_description_set boolean, p_display_order integer, p_active boolean, p_actor_id uuid)
returns table(id uuid, name text, description text, display_order integer, active boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_category public.categories%rowtype; v_old jsonb; v_active boolean;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select c.* into v_category from public.categories c where c.id = p_category_id for update;
  if not found then return; end if;
  if p_name is not null and char_length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_CATEGORY'; end if;
  if coalesce(p_description_set, false) and p_description is not null and char_length(trim(p_description)) > 500 then raise exception 'INVALID_CATEGORY'; end if;
  if p_display_order is not null and (p_display_order < 0 or p_display_order > 1000000) then raise exception 'INVALID_CATEGORY'; end if;
  v_active := coalesce(p_active, v_category.active);
  if v_category.active = true and v_active = false then
    if exists (select 1 from public.products p where p.category_id = p_category_id and p.active = true) then raise exception 'CATEGORY_IN_USE'; end if;
  end if;
  v_old := jsonb_build_object('name', v_category.name, 'description', v_category.description, 'display_order', v_category.display_order, 'active', v_category.active);
  update public.categories c
  set name = coalesce(nullif(trim(p_name), ''), c.name),
      description = case when coalesce(p_description_set, false) then nullif(trim(coalesce(p_description, '')), '') else c.description end,
      display_order = coalesce(p_display_order, c.display_order),
      active = v_active,
      updated_at = timezone('utc', now())
  where c.id = p_category_id
  returning c.* into v_category;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'category_updated', 'category', p_category_id, v_old, jsonb_build_object('name', v_category.name, 'description', v_category.description, 'display_order', v_category.display_order, 'active', v_category.active));
  id := v_category.id; name := v_category.name; description := v_category.description; display_order := v_category.display_order; active := v_category.active; return next;
end;
$$;

create or replace function public.deactivate_category(p_category_id uuid, p_actor_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_category public.categories%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select c.* into v_category from public.categories c where c.id = p_category_id for update;
  if not found then return false; end if;
  if v_category.active = false then return true; end if;
  if exists (select 1 from public.products p where p.category_id = p_category_id and p.active = true) then raise exception 'CATEGORY_IN_USE'; end if;
  update public.categories set active = false, updated_at = timezone('utc', now()) where id = p_category_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'category_archived', 'category', p_category_id, jsonb_build_object('active', true), jsonb_build_object('active', false));
  return true;
end;
$$;

create or replace function public.reactivate_category(p_category_id uuid, p_actor_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_category public.categories%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select c.* into v_category from public.categories c where c.id = p_category_id for update;
  if not found then return false; end if;
  if v_category.active = true then return true; end if;
  update public.categories set active = true, updated_at = timezone('utc', now()) where id = p_category_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'category_restored', 'category', p_category_id, jsonb_build_object('active', false), jsonb_build_object('active', true));
  return true;
end;
$$;
