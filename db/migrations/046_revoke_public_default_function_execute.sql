-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. A schema-
-- scoped default REVOKE does not cancel the global default, so revoke the
-- global default for the dedicated DDL owner and remove any functions created
-- after migration 034 before exposing the allowlisted RPCs to runtime.
alter default privileges for role postaichan_ddl
  revoke execute on functions from public;
revoke execute on all functions in schema public from public;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
       and not exists (
         select 1 from pg_depend d join pg_extension e
           on d.refclassid = 'pg_extension'::regclass and d.refobjid = e.oid
         where d.classid = 'pg_proc'::regclass and d.objid = p.oid
           and d.deptype = 'e' and e.extname = 'pgcrypto'
       )
  ) then
    raise exception 'PUBLIC_FUNCTION_EXECUTE_REMAINS';
  end if;
end;
$$;
