import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/baranburn";
const globalForDatabase = globalThis as typeof globalThis & { __baranburnPool?: Pool };

export const pool = globalForDatabase.__baranburnPool ?? new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

if (process.env.NODE_ENV !== "production") globalForDatabase.__baranburnPool = pool;

export async function query<Row extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<Row>(text, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

export function databaseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "database_error";
}
