#!/usr/bin/env node
/**
 * scripts/migrate.mjs
 * Executes PostgreSQL schema migrations using Drizzle ORM migrator with the
 * privileged migration role (ownlight_migrator).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../drizzle');

/**
 * Runs pending migrations against the target database.
 * @param {string} [connectionUrl]
 * @returns {Promise<{ success: boolean }>}
 */
export async function runMigrations(connectionUrl) {
  const url =
    connectionUrl ||
    process.env.DATABASE_MIGRATOR_URL ||
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://ownlight_migrator:password@127.0.0.1:5432/ownlight_dev';

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder });
    return { success: true };
  } finally {
    await client.end();
  }
}

if (process.argv[1] === __filename) {
  try {
    await runMigrations();
    console.log('Database migrations applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
