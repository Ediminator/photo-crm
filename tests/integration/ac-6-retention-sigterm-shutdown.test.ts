import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { inArray } from 'drizzle-orm';
import path from 'node:path';
import * as schema from '@/server/db/schema';
import { auditEvents, type AuditEvent } from '@/server/db/schema/audit';
import {
  defineRetentionPolicy,
  registerPolicy,
  resetPolicies,
  runRetentionSweep,
} from '@/server/retention';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('AC-6: SIGTERM Graceful Shutdown and Batch Transaction Atomicity', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-6: when abort/SIGTERM occurs after batch 1, batch 1 is committed atomically and subsequent batches are not executed', async () => {
    resetPolicies();
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const cutoffDate = new Date('2024-01-01T00:00:00.000Z');
      const now = new Date('2026-10-10T12:00:00.000Z');

      // Seed 6 old records (3 batches of size 2)
      const ids = [
        '01912345-6789-7abc-8def-012345678901',
        '01912345-6789-7abc-8def-012345678902',
        '01912345-6789-7abc-8def-012345678903',
        '01912345-6789-7abc-8def-012345678904',
        '01912345-6789-7abc-8def-012345678905',
        '01912345-6789-7abc-8def-012345678906',
      ];

      for (const id of ids) {
        await db.insert(auditEvents).values({
          id,
          occurredAt: cutoffDate,
          actorType: 'system',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: null,
        });
      }

      const policy = defineRetentionPolicy<AuditEvent>({
        id: 'sigterm-test-policy',
        entity: 'audit_events',
        after: { months: 24 },
        action: 'delete',
        batchSize: 2,
        getCandidates: async (c, cutoff, limit, excludedIds) => {
          const all = await c.select().from(auditEvents).limit(limit);
          return all.filter((r) => r.occurredAt < cutoff && !excludedIds.includes(r.id));
        },
        deleteBatch: async (tx, batchIds) => {
          if (batchIds.length === 0) return;
          await tx.delete(auditEvents).where(inArray(auditEvents.id, batchIds));
        },
      });

      registerPolicy(policy);

      const abortController = new AbortController();
      let completedBatches = 0;

      // Execute sweep with batchSize = 2 and simulate SIGTERM abort on batch 0 completion
      const summary = await runRetentionSweep({
        client: db,
        policyIds: ['sigterm-test-policy'],
        batchSize: 2,
        signal: abortController.signal,
        now,
        onBatchComplete: (_policyId, batchIndex) => {
          completedBatches++;
          if (batchIndex === 0) {
            // Simulate SIGTERM signal arriving immediately after batch 1 transaction committed
            abortController.abort();
          }
        },
      });

      // 1. Verify sweep was aborted cleanly
      expect(summary.aborted).toBe(true);
      expect(completedBatches).toBe(1);
      expect(summary.totalDeleted).toBe(2);

      // 2. Verify database records: batch 1 (first 2 items) deleted, batches 2 & 3 (remaining 4 items) preserved
      const remainingRows = await db.select().from(auditEvents);
      expect(remainingRows).toHaveLength(4);

      const remainingIds = remainingRows.map((r) => r.id);
      expect(remainingIds).not.toContain(ids[0]);
      expect(remainingIds).not.toContain(ids[1]);
      expect(remainingIds).toContain(ids[2]);
      expect(remainingIds).toContain(ids[3]);
      expect(remainingIds).toContain(ids[4]);
      expect(remainingIds).toContain(ids[5]);
    } finally {
      await client.close();
    }
  });

  it('AC-6: when failure or abort occurs during an in-flight batch transaction, transaction rolls back atomically with no partial deletions', async () => {
    resetPolicies();
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const cutoffDate = new Date('2024-01-01T00:00:00.000Z');
      const now = new Date('2026-10-10T12:00:00.000Z');

      const batchIds = [
        '01912345-6789-7abc-8def-012345678911',
        '01912345-6789-7abc-8def-012345678912',
      ];

      for (const id of batchIds) {
        await db.insert(auditEvents).values({
          id,
          occurredAt: cutoffDate,
          actorType: 'system',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: null,
        });
      }

      const policy = defineRetentionPolicy<AuditEvent>({
        id: 'atomic-rollback-policy',
        entity: 'audit_events',
        after: { months: 24 },
        action: 'delete',
        batchSize: 2,
        getCandidates: async (c, cutoff, limit, excludedIds) => {
          const all = await c.select().from(auditEvents).limit(limit);
          return all.filter((r) => r.occurredAt < cutoff && !excludedIds.includes(r.id));
        },
        deleteBatch: async (tx, idsToDelete) => {
          // Delete first item, then simulate an unexpected error / kill before commit
          const firstId = idsToDelete[0];
          if (!firstId) {
            throw new Error('No ID to delete');
          }
          await tx.delete(auditEvents).where(inArray(auditEvents.id, [firstId]));
          throw new Error('SIMULATED_SIGTERM_CRASH_MID_BATCH');
        },
      });

      registerPolicy(policy);

      // Attempt sweep; transaction must roll back
      await expect(
        runRetentionSweep({
          client: db,
          policyIds: ['atomic-rollback-policy'],
          batchSize: 2,
          now,
        }),
      ).rejects.toThrow('SIMULATED_SIGTERM_CRASH_MID_BATCH');

      // Verify transaction atomicity: neither row was deleted (no partial deletion)
      const rowsAfterCrash = await db.select().from(auditEvents);
      expect(rowsAfterCrash).toHaveLength(2);
      const remainingIds = rowsAfterCrash.map((r) => r.id);
      expect(remainingIds).toContain(batchIds[0]);
      expect(remainingIds).toContain(batchIds[1]);
    } finally {
      await client.close();
    }
  });
});
