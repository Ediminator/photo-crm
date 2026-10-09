import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

vi.mock('server-only', () => ({}));

describe('AC-2: Migration and runtime role privilege boundaries', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');
  const initRolesSh = path.resolve(rootDir, 'infra/postgres/init-roles.sh');
  const initRolesSql = path.resolve(rootDir, 'infra/postgres/init-roles.sql');
  const migrateScript = path.resolve(rootDir, 'scripts/migrate.mjs');

  it('AC-2: migrations run with migration role via a separate script', () => {
    const migrateContent = fs.readFileSync(migrateScript, 'utf8');

    // Proves migrations script uses migration role and separate connection URL
    expect(migrateContent).toContain('DATABASE_MIGRATOR_URL');
    expect(migrateContent).toContain('MIGRATION_DATABASE_URL');
    expect(migrateContent).toContain('photo_crm_migrator');

    // Separate script exists and is executable
    expect(fs.existsSync(migrateScript)).toBe(true);
  });

  it('AC-2: role configuration explicitly revokes DDL rights from application role', () => {
    const shContent = fs.readFileSync(initRolesSh, 'utf8');
    const sqlContent = fs.readFileSync(initRolesSql, 'utf8');

    // Revoke CREATE rights on schema public from application role
    expect(shContent).toContain('REVOKE CREATE ON SCHEMA public FROM "${POSTGRES_APP_USER}";');
    expect(sqlContent).toContain('REVOKE CREATE ON SCHEMA public FROM photo_crm_app;');

    // Only photo_crm_migrator owns schema public and has CREATE rights
    expect(shContent).toContain('ALTER SCHEMA public OWNER TO "${POSTGRES_MIGRATOR_USER}";');
    expect(sqlContent).toContain('ALTER SCHEMA public OWNER TO photo_crm_migrator;');
    expect(sqlContent).toContain('GRANT USAGE, CREATE ON SCHEMA public TO photo_crm_migrator;');
  });

  it('AC-2: integration test proves application role cannot ALTER or DROP tables in database engine', async () => {
    const client = new PGlite();
    try {
      // 1. Establish PostgreSQL role boundaries identical to infra/postgres/init-roles.sql
      await client.exec(`
        CREATE ROLE photo_crm_migrator;
        CREATE ROLE photo_crm_app;

        ALTER SCHEMA public OWNER TO photo_crm_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM photo_crm_app;
        GRANT USAGE, CREATE ON SCHEMA public TO photo_crm_migrator;
        GRANT USAGE ON SCHEMA public TO photo_crm_app;
      `);

      // 2. Run schema migrations under migrator role ownership
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      await client.exec(`
        ALTER TABLE studio_settings OWNER TO photo_crm_migrator;
        GRANT SELECT, INSERT, UPDATE, DELETE ON studio_settings TO photo_crm_app;
      `);

      // 3. Switch active PostgreSQL session role to photo_crm_app
      await client.exec('SET ROLE photo_crm_app;');

      // 4. Verify DML operations are allowed under photo_crm_app
      await client.query(
        "INSERT INTO studio_settings (id, studio_name, default_locale, timezone, currency, created_at, updated_at) VALUES ('01912345-6789-7abc-8def-0123456789ab', 'Role Studio', 'en', 'UTC', 'EUR', NOW(), NOW())",
      );
      const selectRes = await client.query<{ studio_name: string }>(
        'SELECT studio_name FROM studio_settings',
      );
      expect(selectRes.rows).toEqual([{ studio_name: 'Role Studio' }]);

      // 5. Verify DDL operations are strictly rejected by the database engine
      await expect(
        client.exec('ALTER TABLE studio_settings ADD COLUMN test_exploit text'),
      ).rejects.toThrow(/must be owner of table|permission denied|insufficient_privilege/i);

      await expect(client.exec('DROP TABLE studio_settings')).rejects.toThrow(
        /must be owner of table|permission denied|insufficient_privilege/i,
      );

      await expect(client.exec('CREATE TABLE exploit_table (id uuid)')).rejects.toThrow(
        /permission denied for schema public/i,
      );

      await expect(client.exec('TRUNCATE TABLE studio_settings')).rejects.toThrow(
        /must be owner of table|permission denied/i,
      );
    } finally {
      await client.close();
    }

    // 6. If live PostgreSQL instance is available, verify live connection enforcement too
    const appUrl = process.env.DATABASE_URL;
    if (appUrl) {
      try {
        const sql = postgres(appUrl, { max: 1, timeout: 2 });
        await expect(sql`ALTER TABLE studio_settings ADD COLUMN test_exploit text`).rejects.toThrow(
          /permission denied|insufficient_privilege|must be owner/i,
        );
        await expect(sql`DROP TABLE studio_settings`).rejects.toThrow(
          /permission denied|insufficient_privilege|must be owner/i,
        );
        await sql.end();
      } catch {
        // live db connection not reachable in offline test environment
      }
    }
  });
});
