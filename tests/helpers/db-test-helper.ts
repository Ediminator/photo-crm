import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/server/db/schema';
import type { QueryClient } from '@/server/settings/repo';

export interface TestDatabaseInstance {
  client: PGlite;
  db: QueryClient;
  destroy: () => Promise<void>;
}

const drizzleDir = path.resolve(import.meta.dirname, '../../drizzle');

/**
 * Reads and concatenates all committed SQL migration files from the drizzle/ directory in order.
 */
let cachedSql: string | null = null;

export function loadMigrationSql(): string {
  if (cachedSql) return cachedSql;
  const metaJournalPath = path.resolve(drizzleDir, 'meta/_journal.json');
  if (fs.existsSync(metaJournalPath)) {
    const journal = JSON.parse(fs.readFileSync(metaJournalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const sqlStatements: string[] = [];
    for (const entry of journal.entries) {
      const sqlFile = path.resolve(drizzleDir, `${entry.tag}.sql`);
      if (fs.existsSync(sqlFile)) {
        sqlStatements.push(fs.readFileSync(sqlFile, 'utf8'));
      }
    }
    cachedSql = sqlStatements.join('\n');
    return cachedSql;
  }

  // Fallback: read all .sql files sorted
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return sqlFiles.map((f) => fs.readFileSync(path.resolve(drizzleDir, f), 'utf8')).join('\n');
}

/**
 * Creates an isolated in-memory test database instance with all migrations applied.
 * Guarantees complete test isolation between parallel test files.
 */
export async function createIsolatedTestDatabase(): Promise<TestDatabaseInstance> {
  const client = new PGlite();
  const migrationSql = loadMigrationSql();
  await client.exec(migrationSql);

  const db = drizzle(client, { schema }) as unknown as QueryClient;

  return {
    client,
    db,
    destroy: async () => {
      await client.close();
    },
  };
}
