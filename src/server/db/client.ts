import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/env';

export interface DbClientConfig {
  url?: string;
  maxConnections?: number;
  statementTimeout?: number;
  ssl?: boolean | 'require' | 'prefer';
}

/**
 * Creates a raw postgres connection instance configured with connection limits,
 * statement timeout, SSL, and hardened logging that never exposes query arguments or PII.
 */
export function createPostgresClient(config: DbClientConfig = {}): postgres.Sql {
  const connectionUrl = config.url ?? env.DATABASE_URL;
  const maxConnections = config.maxConnections ?? env.DB_MAX_CONNECTIONS;
  const statementTimeout = config.statementTimeout ?? env.DB_STATEMENT_TIMEOUT;
  const ssl = config.ssl ?? env.DB_SSL;

  return postgres(connectionUrl, {
    max: maxConnections,
    timeout: statementTimeout,
    ssl,
    transform: {
      undefined: null,
    },
    // Query parameters are never logged to prevent credential or personal data leakage
    debug: false,
    onnotice: () => undefined,
  });
}

export type DbClient = PostgresJsDatabase<typeof schema>;

// Global singleton cache for Next.js hot-reload persistence in development
const globalForDb = globalThis as unknown as {
  rawSql: postgres.Sql | undefined;
  db: DbClient | undefined;
};

export function getRawSql(): postgres.Sql {
  globalForDb.rawSql ??= createPostgresClient();
  return globalForDb.rawSql;
}

export function getDb(): DbClient {
  globalForDb.db ??= drizzle(getRawSql(), { schema });
  return globalForDb.db;
}

/**
 * Lazy proxy exports so importing server modules does not eagerly connect
 * or throw during build/test before environment configuration.
 */
export const rawSql: postgres.Sql = new Proxy((() => undefined) as unknown as postgres.Sql, {
  get(_target, prop: string | symbol): unknown {
    const value: unknown = Reflect.get(getRawSql(), prop);
    return value;
  },
  has(_target, prop: string | symbol): boolean {
    return Reflect.has(getRawSql(), prop);
  },
  apply(_target, thisArg: unknown, argArray: unknown[]): unknown {
    const value: unknown = Reflect.apply(getRawSql(), thisArg, argArray);
    return value;
  },
});

export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, prop: string | symbol): unknown {
    const value: unknown = Reflect.get(getDb(), prop);
    return value;
  },
  has(_target, prop: string | symbol): boolean {
    return Reflect.has(getDb(), prop);
  },
});
