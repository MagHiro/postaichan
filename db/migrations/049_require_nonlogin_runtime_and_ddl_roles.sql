do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'postaichan_ddl'
      and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls
  ) then
    raise exception 'POSTAICHAN_DDL_ROLE_MUST_BE_NONLOGIN_NONPRIVILEGED';
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'postaichan_runtime'
      and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls
  ) then
    raise exception 'POSTAICHAN_RUNTIME_ROLE_MUST_BE_NONLOGIN_NONPRIVILEGED';
  end if;
end;
$$;
