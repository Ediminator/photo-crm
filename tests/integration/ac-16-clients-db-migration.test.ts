import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

vi.mock('server-only', () => ({}));

describe('AC-16: Database migration, constraints, cascade deletion, and role privileges', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-16: applies migrations to fresh database and verifies schema constraints and cascade delete', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      // 1. Verify tables exist
      const tablesRes = await client.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      );
      const tableNames = tablesRes.rows.map((r) => r.tablename);
      expect(tableNames).toContain('clients');
      expect(tableNames).toContain('client_contacts');
      expect(tableNames).toContain('client_addresses');

      // 2. Insert valid client, contact, and address
      const clientId = '01912345-6789-7abc-8def-012345678901';
      const contactId = '01912345-6789-7abc-8def-012345678902';
      const addressId = '01912345-6789-7abc-8def-012345678903';

      await client.query(
        `INSERT INTO clients (id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at)
         VALUES ('${clientId}', 'person', 'Test Person', 'en', NOW(), NOW(), NOW())`,
      );

      await client.query(
        `INSERT INTO client_contacts (id, client_id, given_name, family_name, email, email_normalized, phone, is_primary, created_at, updated_at)
         VALUES ('${contactId}', '${clientId}', 'Test', 'Person', 'test@example.com', 'test@example.com', '+49 30 0000 0001', true, NOW(), NOW())`,
      );

      await client.query(
        `INSERT INTO client_addresses (id, client_id, type, line1, postal_code, city, country_code, created_at, updated_at)
         VALUES ('${addressId}', '${clientId}', 'postal', 'Street 1', '10115', 'Berlin', 'DE', NOW(), NOW())`,
      );

      // Verify rows exist
      const contactCheck = await client.query<{ c: string }>(
        `SELECT count(*) as c FROM client_contacts WHERE client_id = '${clientId}'`,
      );
      expect(Number(contactCheck.rows[0]?.c)).toBe(1);

      const addressCheck = await client.query<{ c: string }>(
        `SELECT count(*) as c FROM client_addresses WHERE client_id = '${clientId}'`,
      );
      expect(Number(addressCheck.rows[0]?.c)).toBe(1);

      // 3. Test CASCADE DELETE: deleting client removes contacts and addresses
      await client.query(`DELETE FROM clients WHERE id = '${clientId}'`);

      const contactAfter = await client.query<{ c: string }>(
        `SELECT count(*) as c FROM client_contacts WHERE client_id = '${clientId}'`,
      );
      expect(Number(contactAfter.rows[0]?.c)).toBe(0);

      const addressAfter = await client.query<{ c: string }>(
        `SELECT count(*) as c FROM client_addresses WHERE client_id = '${clientId}'`,
      );
      expect(Number(addressAfter.rows[0]?.c)).toBe(0);

      // 4. Test check constraints:
      // a) invalid client kind
      await expect(
        client.query(
          `INSERT INTO clients (id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at)
           VALUES ('${clientId}', 'alien', 'Alien Name', 'en', NOW(), NOW(), NOW())`,
        ),
      ).rejects.toThrow(/clients_kind_check/);

      // b) invalid preferred_locale
      await expect(
        client.query(
          `INSERT INTO clients (id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at)
           VALUES ('${clientId}', 'person', 'Alien Name', 'fr', NOW(), NOW(), NOW())`,
        ),
      ).rejects.toThrow(/clients_preferred_locale_check/);

      // c) both contact names empty
      await client.query(
        `INSERT INTO clients (id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at)
         VALUES ('${clientId}', 'person', 'Valid Person', 'en', NOW(), NOW(), NOW())`,
      );

      await expect(
        client.query(
          `INSERT INTO client_contacts (id, client_id, given_name, family_name, created_at, updated_at)
           VALUES ('${contactId}', '${clientId}', '   ', '', NOW(), NOW())`,
        ),
      ).rejects.toThrow(/client_contacts_name_check/);

      // d) invalid address type
      await expect(
        client.query(
          `INSERT INTO client_addresses (id, client_id, type, line1, postal_code, city, country_code, created_at, updated_at)
           VALUES ('${addressId}', '${clientId}', 'vacation', 'Beach 1', '10115', 'Berlin', 'DE', NOW(), NOW())`,
        ),
      ).rejects.toThrow(/client_addresses_type_check/);
    } finally {
      await client.close();
    }
  });

  it('AC-16: verifies application role (ownlight_app) has SELECT/INSERT/UPDATE/DELETE on new tables, but cannot ALTER or DROP', async () => {
    const client = new PGlite();
    try {
      // 1. Establish PostgreSQL role boundaries identical to production infra
      await client.exec(`
        CREATE ROLE ownlight_migrator;
        CREATE ROLE ownlight_app;

        ALTER SCHEMA public OWNER TO ownlight_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM ownlight_app;
        GRANT USAGE, CREATE ON SCHEMA public TO ownlight_migrator;
        GRANT USAGE ON SCHEMA public TO ownlight_app;
      `);

      // 2. Run migrations under migrator role
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      // Grant app role privileges matching infra/postgres/init-roles.sql
      await client.exec(`
        ALTER TABLE clients OWNER TO ownlight_migrator;
        ALTER TABLE client_contacts OWNER TO ownlight_migrator;
        ALTER TABLE client_addresses OWNER TO ownlight_migrator;

        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ownlight_app;
      `);

      // 3. Switch session to ownlight_app
      await client.exec('SET ROLE ownlight_app;');

      const testClientId = '01912345-6789-7abc-8def-012345678999';

      // 4. Verify DML operations (INSERT, SELECT, UPDATE, DELETE) succeed under ownlight_app
      await client.query(
        `INSERT INTO clients (id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at)
         VALUES ('${testClientId}', 'person', 'App Role Client', 'de', NOW(), NOW(), NOW())`,
      );

      const selectRes = await client.query<{ display_name: string }>(
        `SELECT display_name FROM clients WHERE id = '${testClientId}'`,
      );
      expect(selectRes.rows[0]?.display_name).toBe('App Role Client');

      await client.query(
        `UPDATE clients SET display_name = 'Updated Client' WHERE id = '${testClientId}'`,
      );

      await client.query(`DELETE FROM clients WHERE id = '${testClientId}'`);

      // 5. Verify DDL operations (ALTER, DROP) are strictly denied by database engine
      await expect(client.exec('ALTER TABLE clients ADD COLUMN exploit_col text')).rejects.toThrow(
        /must be owner of table|permission denied|insufficient_privilege/i,
      );

      await expect(client.exec('DROP TABLE clients CASCADE')).rejects.toThrow(
        /must be owner of table|permission denied|insufficient_privilege/i,
      );

      await expect(
        client.exec('ALTER TABLE client_contacts ADD COLUMN exploit_col text'),
      ).rejects.toThrow(/must be owner of table|permission denied|insufficient_privilege/i);

      await expect(client.exec('DROP TABLE client_contacts CASCADE')).rejects.toThrow(
        /must be owner of table|permission denied|insufficient_privilege/i,
      );

      await expect(
        client.exec('ALTER TABLE client_addresses ADD COLUMN exploit_col text'),
      ).rejects.toThrow(/must be owner of table|permission denied|insufficient_privilege/i);

      await expect(client.exec('DROP TABLE client_addresses CASCADE')).rejects.toThrow(
        /must be owner of table|permission denied|insufficient_privilege/i,
      );
    } finally {
      await client.close();
    }
  });
});
