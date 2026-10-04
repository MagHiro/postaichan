import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getMigrationDatabaseUrl } from "../lib/config-values.mjs";

const { Client } = pg;
const scrypt = promisify(scryptCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = getMigrationDatabaseUrl();
const production = process.env.NODE_ENV === "production";
const ddlRole = process.env.DATABASE_DDL_ROLE ?? (production ? "" : "postaichan_ddl");
if (production && ddlRole !== "postaichan_ddl") {
  throw new Error("Production seed tasks must use the postaichan_ddl owner role.");
}
if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(ddlRole ?? "")) {
  throw new Error("DATABASE_DDL_ROLE is invalid.");
}
const email = (process.env.ADMIN_EMAIL ?? "admin@baraburn.my.id").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!password || password.length < 12) {
  throw new Error("ADMIN_PASSWORD must be supplied and contain at least 12 characters.");
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await scrypt(value, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${encode(salt)}$${encode(key)}`;
}

const passwordHash = await hashPassword(password);
const seedSql = await readFile(path.join(projectRoot, "db", "seed.sql"), "utf8");
const client = new Client({ connectionString });
await client.connect();
try {
  if (production) {
    const preflight = await client.query(
      `select pg_has_role(current_user, 'postaichan_ddl', 'member') as can_assume_ddl,
              exists(select 1 from pg_roles where rolname = 'postaichan_ddl' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as ddl_role_safe,
              exists(select 1 from pg_roles where rolname = 'postaichan_runtime' and not rolsuper and not rolcanlogin and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as runtime_role_safe,
              exists(select 1 from pg_namespace where nspname = 'public' and nspowner = 'postaichan_ddl'::regrole) as ddl_owns_schema`
    );
    const role = preflight.rows[0];
    if (!role?.can_assume_ddl || !role.ddl_role_safe || !role.runtime_role_safe || !role.ddl_owns_schema) {
      throw new Error("Production seed bootstrap is incomplete; provision the DDL role, schema owner, and admin membership first.");
    }
  }
  await client.query(`set role "${ddlRole}"`);
  await client.query("begin");
  await client.query(
    `insert into public.staff_users(email, password_hash, email_confirmed)
     values ($1, $2, true)
     on conflict (email) do update set password_hash = excluded.password_hash, email_confirmed = true, updated_at = timezone('utc', now())`,
    [email, passwordHash],
  );
  const user = await client.query("select id from public.staff_users where email = $1 for update", [email]);
  if (user.rowCount !== 1) throw new Error("Admin account could not be created.");
  await client.query(
    `insert into public.profiles(id, display_name, role, active)
     values ($1, 'Tempat Taichan Admin', 'admin', true)
     on conflict (id) do update set display_name = excluded.display_name, role = 'admin', active = true, updated_at = timezone('utc', now())`,
    [user.rows[0].id],
  );
  await client.query(seedSql);
  await client.query("commit");
  console.log(`Seeded menu data and ensured the admin account ${email}.`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
