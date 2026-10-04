import { getServerConfig } from "@/lib/config";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const config = getServerConfig();
  if (!config.isProduction) return;
  const { query } = await import("@/lib/db");

  const result = await query<{ is_superuser: boolean; owns_public_schema: boolean; owns_app_objects: boolean; runtime_member: boolean; ddl_member: boolean; runtime_group_safe: boolean; ddl_group_safe: boolean }>(
    `select r.rolsuper as is_superuser,
            exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = 'postaichan_ddl'::regrole) as owns_public_schema,
            exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid)
              or exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proowner = r.oid) as owns_app_objects,
            pg_has_role(current_user, 'postaichan_runtime', 'member') as runtime_member,
            pg_has_role(current_user, 'postaichan_ddl', 'member') as ddl_member,
            exists(select 1 from pg_roles g where g.rolname = 'postaichan_runtime' and not g.rolsuper and not g.rolcanlogin and not g.rolcreatedb and not g.rolcreaterole and not g.rolreplication and not g.rolbypassrls) as runtime_group_safe,
            exists(select 1 from pg_roles g where g.rolname = 'postaichan_ddl' and not g.rolsuper and not g.rolcanlogin and not g.rolcreatedb and not g.rolcreaterole and not g.rolreplication and not g.rolbypassrls) as ddl_group_safe
     from pg_roles r where r.rolname = current_user`,
  );
  const role = result.rows[0];
  if (!role || role.is_superuser || !role.owns_public_schema || role.owns_app_objects || !role.runtime_member || !role.ddl_member || !role.runtime_group_safe || !role.ddl_group_safe) {
    throw new Error("Unsafe production database role configuration; DATABASE_URL must be a non-superuser member of postaichan_runtime and postaichan_ddl, with application objects owned by postaichan_ddl.");
  }
}
