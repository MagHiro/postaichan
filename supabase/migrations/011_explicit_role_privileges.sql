-- Supabase projects often have explicit anon/authenticated grants in addition
-- to PUBLIC. Revoke those explicit grants; the application uses service_role
-- only after its own server-side authorization checks.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- The server-side session client still needs to verify the signed-in user's
-- own profile. RLS remains the row boundary (id = auth.uid()).
grant select (id, display_name, role, active) on public.profiles to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
