-- Keep account creation inside an audited SECURITY DEFINER function so the
-- runtime login does not need direct profile/staff credential write grants.
create or replace function public.create_staff_account(
  p_email text, p_password_hash text, p_display_name text,
  p_role public.staff_role, p_actor_id uuid
) returns public.profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid; v_profile public.profiles%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_email is null or p_email <> lower(trim(p_email)) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(p_email) > 254
     or p_password_hash is null or p_password_hash !~ '^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{20,30}\$[A-Za-z0-9_-]{80,100}$'
     or p_display_name is null or char_length(trim(p_display_name)) not between 2 and 80
     or p_role is null then raise exception 'INVALID_STAFF_ACCOUNT'; end if;
  insert into public.staff_users(email, password_hash, email_confirmed)
  values (p_email, p_password_hash, true) returning id into v_user_id;
  select * into v_profile from public.provision_staff_profile(v_user_id, p_display_name, p_role, p_actor_id);
  return v_profile;
end;
$$;

-- Existing production installations had broad grants from earlier migrations.
-- Runtime reads are required throughout the server; direct writes are limited
-- to logout/activity timestamps, customer sessions, verified provider events,
-- and menu image storage. Financial and staff state changes go through RPCs.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from postaichan_runtime;
grant insert on public.customer_sessions, public.payment_events to postaichan_runtime;
grant insert, delete on public.menu_images to postaichan_runtime;
grant update (last_login_at) on public.staff_users to postaichan_runtime;
grant update (last_seen_at, revoked_at) on public.staff_sessions to postaichan_runtime;

revoke all privileges on all sequences in schema public from postaichan_runtime;
alter default privileges for role postaichan_ddl in schema public revoke all on tables from postaichan_runtime;
alter default privileges for role postaichan_ddl in schema public grant select on tables to postaichan_runtime;
alter default privileges for role postaichan_ddl in schema public revoke all on sequences from postaichan_runtime;
alter default privileges for role postaichan_ddl in schema public revoke execute on functions from postaichan_runtime;

revoke execute on all functions in schema public from postaichan_runtime;
grant execute on function public.apply_payment_transition(uuid, public.payment_status, text, text, integer, timestamptz) to postaichan_runtime;
grant execute on function public.archive_product(uuid, uuid) to postaichan_runtime;
grant execute on function public.cancel_order(uuid, text, uuid) to postaichan_runtime;
grant execute on function public.change_staff_password(uuid, text, uuid, text) to postaichan_runtime;
grant execute on function public.claim_payment_provider_create(uuid) to postaichan_runtime;
grant execute on function public.claim_payment_refund(uuid, integer, text, uuid, uuid) to postaichan_runtime;
grant execute on function public.cleanup_stale_sessions_and_rate_limits() to postaichan_runtime;
grant execute on function public.close_cashier_shift(uuid, text) to postaichan_runtime;
grant execute on function public.complete_orphaned_settlement_refund(uuid, uuid, text) to postaichan_runtime;
grant execute on function public.consume_rate_limit(text, integer, integer) to postaichan_runtime;
grant execute on function public.create_category(text, text, integer, uuid) to postaichan_runtime;
grant execute on function public.create_checkout_intent(uuid, text, text, uuid, uuid, public.payment_method, jsonb) to postaichan_runtime;
grant execute on function public.create_general_qr(text, text, uuid) to postaichan_runtime;
grant execute on function public.create_modifier_group(text, text, text, boolean, integer, integer, integer, uuid) to postaichan_runtime;
grant execute on function public.create_modifier_option(text, uuid, text, integer, integer, boolean, integer, uuid) to postaichan_runtime;
grant execute on function public.create_product_with_audit(uuid, text, text, text, integer, integer, boolean, boolean, integer, uuid) to postaichan_runtime;
grant execute on function public.create_staff_account(text, text, text, public.staff_role, uuid) to postaichan_runtime;
grant execute on function public.create_staff_session(uuid, text, timestamptz) to postaichan_runtime;
grant execute on function public.create_table_with_qr(text, text, boolean, text, uuid) to postaichan_runtime;
grant execute on function public.deactivate_category(uuid, uuid) to postaichan_runtime;
grant execute on function public.delete_category(uuid, uuid) to postaichan_runtime;
grant execute on function public.delete_modifier_group(text, uuid, uuid) to postaichan_runtime;
grant execute on function public.delete_modifier_option(text, uuid, uuid) to postaichan_runtime;
grant execute on function public.finalize_payment_provider_create(uuid, uuid, text, text, timestamptz) to postaichan_runtime;
grant execute on function public.finalize_payment_refund_attempt(uuid, uuid, uuid) to postaichan_runtime;
grant execute on function public.mark_provider_refund_notification(uuid, text, jsonb) to postaichan_runtime;
grant execute on function public.open_cashier_shift(uuid, text, jsonb) to postaichan_runtime;
grant execute on function public.prepare_provider_confirmed_refund_attempt(uuid, text, integer, text, uuid) to postaichan_runtime;
grant execute on function public.reactivate_category(uuid, uuid) to postaichan_runtime;
grant execute on function public.reconcile_orphaned_settlement(uuid, text, uuid, text) to postaichan_runtime;
grant execute on function public.record_provider_reconciliation_alert(text, uuid, text, jsonb) to postaichan_runtime;
grant execute on function public.release_expired_inventory_reservations() to postaichan_runtime;
grant execute on function public.release_payment_provider_create(uuid, uuid, text, boolean) to postaichan_runtime;
grant execute on function public.restore_product(uuid, uuid) to postaichan_runtime;
grant execute on function public.revoke_staff_sessions(uuid, uuid) to postaichan_runtime;
grant execute on function public.rotate_general_qr(uuid, text, uuid) to postaichan_runtime;
grant execute on function public.rotate_table_qr(uuid, text, uuid) to postaichan_runtime;
grant execute on function public.set_product_modifier_groups(uuid, uuid[], uuid[], uuid) to postaichan_runtime;
grant execute on function public.set_refund_attempt_state(uuid, uuid, text, text, jsonb) to postaichan_runtime;
grant execute on function public.transition_order_status(uuid, public.order_status, public.order_status, uuid) to postaichan_runtime;
grant execute on function public.update_category(uuid, text, text, boolean, integer, boolean, uuid) to postaichan_runtime;
grant execute on function public.update_general_qr(uuid, text, boolean, uuid) to postaichan_runtime;
grant execute on function public.update_modifier_group(text, uuid, text, text, boolean, integer, integer, integer, boolean, uuid) to postaichan_runtime;
grant execute on function public.update_modifier_option(text, uuid, text, integer, integer, boolean, integer, uuid) to postaichan_runtime;
grant execute on function public.update_product_with_audit(uuid, uuid, text, text, text, integer, integer, boolean, boolean, integer, text, uuid) to postaichan_runtime;
grant execute on function public.update_staff_profile(uuid, boolean, public.staff_role, uuid) to postaichan_runtime;
grant execute on function public.update_table_metadata(uuid, text, text, boolean, uuid) to postaichan_runtime;
