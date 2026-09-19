import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(projectRoot, "db", "migrations");
const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/baranburn";

const client = new Client({ connectionString });
await client.connect();
try {
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
