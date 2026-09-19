-- PostgreSQL application-owned authentication and session hardening.
-- Passwords are scrypt hashes created by the application seed/auth code.

create index if not exists profiles_active_role_idx on public.profiles(active, role);
create index if not exists staff_users_email_idx on public.staff_users(lower(email));

create or replace function public.revoke_expired_staff_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.staff_sessions
  set revoked_at = coalesce(revoked_at, timezone('utc', now()))
  where revoked_at is null and expires_at <= timezone('utc', now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
