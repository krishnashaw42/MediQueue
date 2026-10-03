import { Pool, types } from 'pg';
import type { PoolClient } from 'pg';
export { schema } from './schema';
export type Query = (sql: string, params?: unknown[]) => Promise<{rows: unknown[]; rowCount: number | null | undefined}>;
export type Database = { query: Query; transaction<T>(fn: (query: Query) => Promise<T>): Promise<T> };
// Counts and epoch milliseconds are within JS safe integer range in this app.
types.setTypeParser(20, value => { const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds safe range'); return n; });
types.setTypeParser(1700, Number);
export function sqlForPostgres(sql: string) {
  let parameter = 0;
  return sql.replace(/'([^']|'')*'|\?|\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g, word => {
    if (word.startsWith("'")) return word;
    if (word === '?') return `$${++parameter}`;
    return `"${word}"`;
  });
}
let cached: Database | undefined;
export function database(): Database {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString)
    throw new Error('DATABASE_URL or POSTGRES_URL is required');
  const ca = process.env.DATABASE_CA_CERT?.replaceAll('\\n','\n');
  const url = new URL(connectionString);
  // Set TLS explicitly because node-postgres otherwise interprets
  // `sslmode=require` differently from libpq. Vercel's generated Supabase
  // URL guarantees encrypted transport; supplying the project CA upgrades
  // this to certificate and hostname verification.
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert'])
    url.searchParams.delete(key);
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false },
    max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Database connection failed'));
  const query: Query = async (sql, params = []) => pool.query(sql, params);
  cached = {
    query,
    async transaction<T>(fn: (query: Query) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        // Preserve SQLite's single-writer semantics across serverless instances.
        // Transaction-scoped lock works with the Supabase transaction pooler.
        await client.query('SELECT pg_advisory_xact_lock(73291001)');
        const result = await fn(async (sql, params = []) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
  return cached;
}
