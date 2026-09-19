-- Remove the implicit PUBLIC execute ACL left on helper functions. Server
-- routes use service_role grants; RLS helpers run through security definer.
revoke all on all functions in schema public from public;
