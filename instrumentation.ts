import { getServerConfig } from "@/lib/config";
import { isSafeProductionDatabaseRole, type ProductionDatabaseRole } from "@/lib/security/production-database-role";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const config = getServerConfig();
  if (!config.isProduction) return;
  const { query } = await import("@/lib/db");

  const result = await query<ProductionDatabaseRole>(
    `select r.rolsuper as is_superuser,
            exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = (select oid from pg_roles where rolname = 'postaichan_ddl')) as owns_public_schema,
            exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid)
              or exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proowner = r.oid) as owns_app_objects,
            pg_has_role(current_user, (select oid from pg_roles where rolname = 'postaichan_runtime'), 'member') as runtime_member,
            pg_has_role(current_user, (select oid from pg_roles where rolname = 'postaichan_ddl'), 'member') as ddl_member,
            exists(select 1 from pg_roles g where g.rolname = 'postaichan_runtime' and not g.rolsuper and not g.rolcanlogin and not g.rolcreatedb and not g.rolcreaterole and not g.rolreplication and not g.rolbypassrls) as runtime_group_safe,
            exists(select 1 from pg_roles g where g.rolname = 'postaichan_ddl' and not g.rolsuper and not g.rolcanlogin and not g.rolcreatedb and not g.rolcreaterole and not g.rolreplication and not g.rolbypassrls) as ddl_group_safe
     from pg_roles r where r.rolname = current_user`,
  );
  const role = result.rows[0];
  if (!isSafeProductionDatabaseRole(role)) {
    throw new Error("Unsafe production database role configuration; DATABASE_URL must use a non-superuser member of both postaichan_runtime and postaichan_ddl; the login must not directly own application objects, and postaichan_ddl must own the public schema. See README.md: Database roles and migrations.");
  }
}
