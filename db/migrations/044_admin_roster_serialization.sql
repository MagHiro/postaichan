create or replace function public.update_staff_profile(
  p_user_id uuid, p_active boolean, p_role public.staff_role, p_actor_id uuid
) returns public.profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_old public.profiles%rowtype;
  v_admin_count integer;
  v_revoked integer;
begin
  -- Serialize administrator removals and recheck the actor after waiting so
  -- two concurrent admins cannot deactivate each other from the last two.
  perform pg_advisory_xact_lock(hashtext('active_admin_roster'));
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  v_old := v_profile;
  if p_user_id = p_actor_id and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') then
    raise exception 'SELF_ADMIN_PROTECTION';
  end if;
  if v_profile.role = 'admin' and v_profile.active
     and (coalesce(p_active, v_profile.active) = false or coalesce(p_role, v_profile.role) <> 'admin') then
    select count(*) into v_admin_count from public.profiles where role = 'admin' and active = true;
    if v_admin_count <= 1 then raise exception 'LAST_ACTIVE_ADMIN'; end if;
  end if;
  update public.profiles set active = coalesce(p_active, active), role = coalesce(p_role, role),
    updated_at = timezone('utc', now()) where id = p_user_id returning * into v_profile;
  if v_old.active and not v_profile.active then
    update public.staff_sessions set revoked_at = coalesce(revoked_at, timezone('utc', now()))
    where staff_user_id = p_user_id and revoked_at is null;
    get diagnostics v_revoked = row_count;
  else
    v_revoked := 0;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor_id, 'staff_updated', 'profile', p_user_id,
    jsonb_build_object('active', v_old.active, 'role', v_old.role),
    jsonb_build_object('active', v_profile.active, 'role', v_profile.role, 'revoked_session_count', v_revoked));
  return v_profile;
end;
$$;
