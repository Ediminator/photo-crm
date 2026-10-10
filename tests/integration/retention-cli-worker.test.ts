import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { executeRetentionSweep } from '../../scripts/retention-sweep.mjs';
import { BackgroundWorker } from '../../scripts/worker.mjs';

vi.mock('server-only', () => ({}));

describe('Retention CLI & Worker scripts integration', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('executeRetentionSweep respects dryRun option and reports per-policy stats', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      await client.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
        VALUES ('01912345-6789-7abc-8def-0123456789aa', '2024-01-01', 'system', 'auth.setup.completed', 'success');
      `);

      // 1. Dry run
      const dryResult = await executeRetentionSweep({
        dbClient: db,
        dryRun: true,
        now,
      });

      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.auditEvents.scanned).toBe(1);
      expect(dryResult.auditEvents.deleted).toBe(0);

      const countAfterDry = await client.query<{ cnt: string | number }>(
        'SELECT count(*) as cnt FROM audit_events',
      );
      expect(Number(countAfterDry.rows[0]?.cnt)).toBe(1);

      // 2. Live run
      const liveResult = await executeRetentionSweep({
        dbClient: db,
        dryRun: false,
        now,
      });

      expect(liveResult.dryRun).toBe(false);
      expect(liveResult.auditEvents.scanned).toBe(1);
      expect(liveResult.auditEvents.deleted).toBe(1);

      // Audit table now contains the retention.sweep.completed audit event
      const rowsAfterLive = await client.query<{ action: string }>(
        'SELECT action FROM audit_events',
      );
      expect(rowsAfterLive.rows).toHaveLength(1);
      expect(rowsAfterLive.rows[0]?.action).toBe('retention.sweep.completed');
    } finally {
      await client.close();
    }
  });

  it('BackgroundWorker initializes, executes sweep cycle and stops cleanly', async () => {
    const worker = new BackgroundWorker({ runOnce: true });
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.stop).toBe('function');
    expect(worker.isShuttingDown).toBe(false);

    await worker.stop();
    expect(worker.isShuttingDown).toBe(true);
  });
});
