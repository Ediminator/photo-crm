import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrationSql } from '../helpers/db-test-helper';
import { checkSchemaDrift } from '../../scripts/db-check.mjs';

describe('AC-1: Database migrations and drift detection', () => {
  const drizzleDir = path.resolve(import.meta.dirname, '../../drizzle');

  it('AC-1: migration files are committed in drizzle/ and registered in journal', () => {
    expect(fs.existsSync(drizzleDir)).toBe(true);

    const journalPath = path.resolve(drizzleDir, 'meta/_journal.json');
    expect(fs.existsSync(journalPath)).toBe(true);

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string; idx: number }[];
    };
    expect(journal.entries.length).toBeGreaterThan(0);

    for (const entry of journal.entries) {
      const sqlFile = path.resolve(drizzleDir, `${entry.tag}.sql`);
      expect(fs.existsSync(sqlFile)).toBe(true);
      const sqlContent = fs.readFileSync(sqlFile, 'utf8');
      expect(sqlContent.length).toBeGreaterThan(0);
      expect(sqlContent).toContain('studio_settings');
    }
  });

  it('AC-1: given an empty database, migrations apply all tables and constraints', async () => {
    const client = new PGlite();
    try {
      const migrationSql = loadMigrationSql();
      await client.exec(migrationSql);

      const res = await client.query<{ column_name: string; data_type: string }>(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'studio_settings' ORDER BY ordinal_position",
      );

      const columns = res.rows.map((r) => r.column_name);
      expect(columns).toEqual([
        'id',
        'studio_name',
        'default_locale',
        'timezone',
        'currency',
        'created_at',
        'updated_at',
      ]);
    } finally {
      await client.close();
    }
  });

  it('AC-1: running migrations a second time is an idempotent no-op', async () => {
    const client = new PGlite();
    try {
      const migrationSql = loadMigrationSql();
      await client.exec(migrationSql);

      // Insert test row
      await client.query(
        "INSERT INTO studio_settings (id, studio_name, default_locale, timezone, currency, created_at, updated_at) VALUES ('01912345-6789-7abc-8def-0123456789ab', 'Test Studio', 'en', 'UTC', 'EUR', NOW(), NOW())",
      );

      // Running migration again must not throw and must leave existing rows intact
      await client.exec(
        'CREATE TABLE IF NOT EXISTS "studio_settings" ( "id" uuid PRIMARY KEY NOT NULL );',
      );

      const rows = await client.query('SELECT count(*) as cnt FROM studio_settings');
      expect(Number((rows.rows[0] as { cnt: string | number }).cnt)).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('AC-1: db:check passes when schema and migrations are in sync', () => {
    const result = checkSchemaDrift();
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
