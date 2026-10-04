-- Dedicated DDL owner and non-login privilege group for application traffic.
-- Provision login credentials outside SQL; see README production operations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postaichan_ddl') then
    create role postaichan_ddl nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'postaichan_runtime') then
    create role postaichan_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end;
$$;

-- Migration execution must already be SET ROLE postaichan_ddl so every new
-- object and default privilege has one predictable owner.
do $$
begin
  if current_user <> 'postaichan_ddl' then
    raise exception 'MIGRATIONS_MUST_RUN_AS_POSTAICHAN_DDL';
  end if;
end;
$$;

alter schema public owner to postaichan_ddl;
revoke all on schema public from public;
grant usage on schema public to postaichan_runtime;

-- The migration role must own all application objects after this point. This
-- also upgrades installations whose earlier DDL used a temporary admin login.
do $$
declare obj record;
begin
  for obj in
    select c.relkind, format('%I.%I', n.nspname, c.relname) as object_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  loop
    if obj.relkind = 'S' then execute format('alter sequence %s owner to postaichan_ddl', obj.object_name);
    elsif obj.relkind = 'v' then execute format('alter view %s owner to postaichan_ddl', obj.object_name);
    elsif obj.relkind = 'm' then execute format('alter materialized view %s owner to postaichan_ddl', obj.object_name);
    elsif obj.relkind = 'f' then execute format('alter foreign table %s owner to postaichan_ddl', obj.object_name);
    else execute format('alter table %s owner to postaichan_ddl', obj.object_name);
    end if;
  end loop;
  for obj in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('alter function %s owner to postaichan_ddl', obj.signature);
    execute format('alter function %s set search_path to public, pg_temp', obj.signature);
  end loop;
  for obj in
    select t.oid::regtype as type_name
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','d','c') and t.typrelid = 0
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
      )
  loop
    execute format('alter type %s owner to postaichan_ddl', obj.type_name);
  end loop;
end;
$$;

revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;
revoke all privileges on all procedures in schema public from public;
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC_FUNCTION_EXECUTE_REMAINS: revoke PUBLIC EXECUTE and grant required extension functions to postaichan_ddl before migrating';
  end if;
  if exists (
    select 1 from pg_extension e
    join pg_depend d on d.refclassid = 'pg_extension'::regclass and d.refobjid = e.oid and d.deptype = 'e'
    join pg_proc p on d.classid = 'pg_proc'::regclass and d.objid = p.oid
    where e.extname = 'pgcrypto' and not has_function_privilege('postaichan_ddl', p.oid, 'EXECUTE')
  ) then
    raise exception 'DDL_OWNER_CANNOT_EXECUTE_PGCRYPTO: grant pgcrypto function execution to postaichan_ddl before migrating';
  end if;
end;
$$;
-- Broad DML and EXECUTE are never granted, even temporarily. Migration 037
-- applies the runtime write and function allowlists after all RPCs exist.
grant select on all tables in schema public to postaichan_runtime;

do $$
declare obj record;
begin
  for obj in
    select t.oid::regtype as type_name
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','d')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on type %s from public', obj.type_name);
    execute format('grant usage on type %s to postaichan_runtime', obj.type_name);
  end loop;
end;
$$;

-- Runtime code never reads or mutates migration bookkeeping.
revoke all on table public.schema_migrations from postaichan_runtime;

alter default privileges for role postaichan_ddl in schema public revoke all on tables from public;
alter default privileges for role postaichan_ddl in schema public revoke all on sequences from public;
alter default privileges for role postaichan_ddl in schema public revoke execute on functions from public;
alter default privileges for role postaichan_ddl in schema public revoke usage on types from public;
alter default privileges for role postaichan_ddl in schema public grant select on tables to postaichan_runtime;
alter default privileges for role postaichan_ddl in schema public grant usage on types to postaichan_runtime;
