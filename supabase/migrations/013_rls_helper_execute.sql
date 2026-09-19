-- RLS evaluates the original profile policies as well as the narrowed policy.
-- These helpers expose only a boolean and are safe for authenticated policy
-- evaluation; all data access remains constrained by RLS and column grants.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
