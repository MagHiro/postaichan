import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getMigrationDatabaseUrl } from "../lib/config-values.mjs";

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(projectRoot, "db", "migrations");
const connectionString = getMigrationDatabaseUrl();
const production = process.env.NODE_ENV === "production";
const ddlRole = process.env.DATABASE_DDL_ROLE ?? (production ? "" : "postaichan_ddl");
if (production && ddlRole !== "postaichan_ddl") {
  throw new Error("Production migrations must use the postaichan_ddl owner role.");
}
if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(ddlRole ?? "")) {
  throw new Error("DATABASE_DDL_ROLE is invalid.");
}

const client = new Client({ connectionString });
await client.connect();
try {
  if (!production) {
    await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'postaichan_ddl') then create role postaichan_ddl nologin; end if; end $$");
    await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'postaichan_runtime') then create role postaichan_runtime nologin; end if; end $$");
    await client.query("alter schema public owner to postaichan_ddl");
    const databaseName = (await client.query("select current_database() as name")).rows[0].name;
    await client.query(`grant create on database "${String(databaseName).replaceAll('"', '""')}" to postaichan_ddl`);
  } else {
    const preflight = await client.query(
      `select pg_has_role(current_user, (select oid from pg_roles where rolname = 'postaichan_ddl'), 'member') as can_assume_ddl,
              exists(select 1 from pg_roles where rolname = 'postaichan_ddl' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as ddl_role_safe,
              exists(select 1 from pg_roles where rolname = 'postaichan_runtime' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as runtime_role_safe,
              exists(select 1 from pg_namespace where nspname = 'public' and nspowner = (select oid from pg_roles where rolname = 'postaichan_ddl')) as ddl_owns_schema,
              has_database_privilege((select oid from pg_roles where rolname = 'postaichan_ddl'), current_database(), 'CREATE') as ddl_can_create`
    );
    const role = preflight.rows[0];
    if (!role?.can_assume_ddl || !role.ddl_role_safe || !role.runtime_role_safe || !role.ddl_owns_schema || !role.ddl_can_create) {
      throw new Error("Production database bootstrap is incomplete; provision postaichan_ddl and postaichan_runtime, schema ownership, the database CREATE grant, and DATABASE_URL login membership first. See README.md: Database roles and migrations.");
    }
  }
  // pgcrypto's C functions are extension-owned by the bootstrap administrator,
  // not by the DDL role. Remove their PUBLIC grants and grant DDL-only access
  // before entering the schema owner role.
  await client.query("create extension if not exists pgcrypto");
  const pgcryptoFunctions = await client.query(
    `select p.oid::regprocedure::text as signature
     from pg_proc p join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
     join pg_extension e on d.refclassid = 'pg_extension'::regclass and d.refobjid = e.oid
     where e.extname = 'pgcrypto' order by p.oid`,
  );
  for (const row of pgcryptoFunctions.rows) {
    await client.query(`revoke execute on function ${row.signature} from public`);
    await client.query(`grant execute on function ${row.signature} to postaichan_ddl`);
  }
  const pgcryptoAcl = await client.query(
    `select exists(
              select 1 from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
              join pg_extension e on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
              cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
              where e.extname='pgcrypto' and a.grantee=0 and a.privilege_type='EXECUTE'
            ) as public_execute,
            exists(
              select 1 from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
              join pg_extension e on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
              where e.extname='pgcrypto' and not has_function_privilege('postaichan_ddl',p.oid,'EXECUTE')
            ) as ddl_execute_missing`,
  );
  if (pgcryptoAcl.rows[0]?.public_execute || pgcryptoAcl.rows[0]?.ddl_execute_missing) {
    throw new Error("pgcrypto privileges are not provisioned; revoke PUBLIC EXECUTE and grant its functions to postaichan_ddl with the database administrator login.");
  }
  try {
    await client.query(`do $$
    declare obj record;
    begin
      for obj in
        select c.relkind, format('%I.%I', n.nspname, c.relname) as object_name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')
          and c.relowner <> 'postaichan_ddl'::regrole
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
        where n.nspname = 'public' and p.proowner <> 'postaichan_ddl'::regrole
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
        where n.nspname = 'public' and t.typtype in ('e','d') and t.typrelid = 0
          and t.typowner <> 'postaichan_ddl'::regrole
          and not exists (
            select 1 from pg_depend d
            where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
          )
      loop
        execute format('alter type %s owner to postaichan_ddl', obj.type_name);
      end loop;
    end;
    $$`);
  } catch {
    throw new Error("Existing public database objects must be transferred to postaichan_ddl by an authorized database owner before migrations can continue.");
  }
  await client.query(`set role "${ddlRole}"`);
  await client.query("select pg_advisory_lock(4815162342)");
  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default timezone('utc', now())
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const appliedResult = await client.query("select version from public.schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.version));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations(version) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : "unknown database error"}`);
    }
  }
  console.log("Database migrations are up to date.");
} finally {
  await client.query("select pg_advisory_unlock(4815162342)").catch(() => undefined);
  await client.end();
}
