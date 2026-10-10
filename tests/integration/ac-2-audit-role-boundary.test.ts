import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

vi.mock('server-only', () => ({}));

describe('AC-2: Audit events append-only database role boundary and trigger protection', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-2: ownlight_app cannot UPDATE or DELETE on audit_events; retention role can DELETE; UPDATE is completely blocked', async () => {
    const client = new PGlite();
    try {
      // 1. Establish PostgreSQL role boundaries
      await client.exec(`
        CREATE ROLE ownlight_migrator;
        CREATE ROLE ownlight_app;
        CREATE ROLE ownlight_retention;

        ALTER SCHEMA public OWNER TO ownlight_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM ownlight_app;
        REVOKE CREATE ON SCHEMA public FROM ownlight_retention;

        GRANT USAGE, CREATE ON SCHEMA public TO ownlight_migrator;
        GRANT USAGE ON SCHEMA public TO ownlight_app;
        GRANT USAGE ON SCHEMA public TO ownlight_retention;
      `);

      // 2. Run migrations under migrator role
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      // Grant privileges reflecting production setup
      await client.exec(`
        ALTER TABLE audit_events OWNER TO ownlight_migrator;
        REVOKE ALL ON audit_events FROM ownlight_app;
        GRANT SELECT, INSERT ON audit_events TO ownlight_app;

        REVOKE ALL ON audit_events FROM ownlight_retention;
        GRANT SELECT, DELETE ON audit_events TO ownlight_retention;
      `);

      // 3. Switch role to ownlight_app
      await client.exec('SET ROLE ownlight_app;');

      const eventId = '01912345-6789-7abc-8def-0123456789ac';
      // 3a. ownlight_app can INSERT audit events
      await client.query(
        `INSERT INTO audit_events (id, occurred_at, actor_type, actor_id, action, target_type, target_id, outcome, metadata)
         VALUES ('${eventId}', NOW(), 'owner', 'usr-1', 'auth.sign_in.success', 'session', 'sess-1', 'success', '{"ip_anonymized":"192.168.1.0/24"}')`,
      );

      // 3b. ownlight_app can SELECT audit events
      const selectRes = await client.query<{ id: string; action: string }>(
        `SELECT id, action FROM audit_events WHERE id = '${eventId}'`,
      );
      expect(selectRes.rows).toEqual([{ id: eventId, action: 'auth.sign_in.success' }]);

      // 3c. ownlight_app UPDATE is strictly rejected (by permissions and trigger)
      await expect(
        client.exec(`UPDATE audit_events SET action = 'tampered' WHERE id = '${eventId}'`),
      ).rejects.toThrow(/permission denied|append-only|cannot be updated/i);

      // 3d. ownlight_app DELETE is strictly rejected (by permissions and trigger)
      await expect(client.exec(`DELETE FROM audit_events WHERE id = '${eventId}'`)).rejects.toThrow(
        /permission denied|append-only/i,
      );

      // 4. Switch role to ownlight_retention
      await client.exec('SET ROLE ownlight_retention;');

      // 4a. retention role cannot UPDATE (permission denied)
      await expect(
        client.exec(`UPDATE audit_events SET action = 'tampered' WHERE id = '${eventId}'`),
      ).rejects.toThrow(/permission denied|cannot be updated|append-only/i);

      // 4b. retention role can DELETE rows matching policy
      await client.query(`DELETE FROM audit_events WHERE id = '${eventId}'`);
      const afterDelete = await client.query(`SELECT id FROM audit_events WHERE id = '${eventId}'`);
      expect(afterDelete.rows).toEqual([]);

      // 5. Switch back to table owner (ownlight_migrator) to prove trigger rejects UPDATE even for owner
      await client.exec('SET ROLE ownlight_migrator;');
      const eventId2 = '01912345-6789-7abc-8def-0123456789ad';
      await client.query(
        `INSERT INTO audit_events (id, occurred_at, actor_type, actor_id, action, target_type, target_id, outcome, metadata)
         VALUES ('${eventId2}', NOW(), 'system', 'sys-1', 'auth.setup.completed', 'user', 'usr-1', 'success', null)`,
      );

      // Even the table owner is blocked by the trigger from mutating audit logs
      await expect(
        client.exec(`UPDATE audit_events SET action = 'tampered' WHERE id = '${eventId2}'`),
      ).rejects.toThrow(/audit_events rows cannot be updated/i);
    } finally {
      await client.close();
    }
  });
});
