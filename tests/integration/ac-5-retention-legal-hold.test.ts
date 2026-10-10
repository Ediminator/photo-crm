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

describe('AC-5: Retention Legal Hold Preservation', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-5: given policy with legalHold, held records are preserved and reported as held while non-held are deleted', async () => {
    resetPolicies();
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');
      const date30MonthsAgo = new Date('2024-04-10T12:00:00.000Z');

      // Seed 4 audit events older than 24 months:
      // 2 with legal hold active, 2 normal eligible for deletion
      const heldId1 = '01912345-6789-7abc-8def-012345678911';
      const heldId2 = '01912345-6789-7abc-8def-012345678912';
      const nonHeldId1 = '01912345-6789-7abc-8def-012345678921';
      const nonHeldId2 = '01912345-6789-7abc-8def-012345678922';

      await db.insert(auditEvents).values([
        {
          id: heldId1,
          occurredAt: date30MonthsAgo,
          actorType: 'owner',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: { legal_hold: true, case_ref: 'DISPUTE-2024-01' },
        },
        {
          id: heldId2,
          occurredAt: date30MonthsAgo,
          actorType: 'system',
          action: 'auth.sign_in.failure',
          outcome: 'failure',
          metadata: { legal_hold: true, case_ref: 'SECURITY-INVESTIGATION-99' },
        },
        {
          id: nonHeldId1,
          occurredAt: date30MonthsAgo,
          actorType: 'owner',
          action: 'auth.sign_in.success',
          outcome: 'success',
          metadata: { legal_hold: false },
        },
        {
          id: nonHeldId2,
          occurredAt: date30MonthsAgo,
          actorType: 'owner',
          action: 'auth.sign_out.success',
          outcome: 'success',
          metadata: null,
        },
      ]);

      // Define and register policy with legal hold predicate
      const policyWithLegalHold = defineRetentionPolicy<AuditEvent>({
        id: 'legal-hold-test-policy',
        entity: 'audit_events',
        after: { months: 24 },
        action: 'delete',
        legalHold: (row) => {
          const meta = row.metadata;
          return meta?.legal_hold === true;
        },
        getCandidates: async (c, cutoff, limit, excludedIds) => {
          const allOld = await c.select().from(auditEvents).limit(limit);
          return allOld.filter((r) => r.occurredAt < cutoff && !excludedIds.includes(r.id));
        },
        deleteBatch: async (tx, ids) => {
          if (ids.length === 0) return;
          await tx.delete(auditEvents).where(inArray(auditEvents.id, ids));
        },
      });

      registerPolicy(policyWithLegalHold);

      // Execute live sweep
      const summary = await runRetentionSweep({
        client: db,
        policyIds: ['legal-hold-test-policy'],
        dryRun: false,
        now,
      });

      expect(summary.totalScanned).toBe(4);
      expect(summary.totalHeld).toBe(2);
      expect(summary.totalDeleted).toBe(2);

      const policyRes = summary.policies.find((p) => p.policyId === 'legal-hold-test-policy');
      expect(policyRes?.heldCount).toBe(2);
      expect(policyRes?.deletedCount).toBe(2);

      // Verify database state: held records preserved, non-held deleted
      const remainingRows = await db.select().from(auditEvents);
      const remainingIds = remainingRows.map((r) => r.id);

      expect(remainingIds).toContain(heldId1);
      expect(remainingIds).toContain(heldId2);
      expect(remainingIds).not.toContain(nonHeldId1);
      expect(remainingIds).not.toContain(nonHeldId2);

      // Verify that the completion audit event was recorded and reports held_count = 2
      const sweepEvents = remainingRows.filter((r) => r.action === 'retention.sweep.completed');
      expect(sweepEvents.length).toBeGreaterThanOrEqual(1);
      expect(sweepEvents[0]?.metadata).toMatchObject({
        policy_id: 'legal-hold-test-policy',
        scanned_count: 4,
        deleted_count: 2,
        held_count: 2,
        dry_run: false,
      });
    } finally {
      await client.close();
    }
  });
});
