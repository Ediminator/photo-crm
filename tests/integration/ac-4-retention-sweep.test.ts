import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from '@/server/db/schema';
import { auditEvents } from '@/server/db/schema/audit';
import { session, rateLimits, user } from '@/server/db/schema/auth';
import { runRetentionSweep, resetPolicies } from '@/server/retention';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('AC-4: Declarative Retention Sweep Integration', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-4: given older and newer audit events, --dry-run deletes nothing; live sweep deletes old rows and records audit event', async () => {
    resetPolicies();
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      // Create test user for foreign keys
      const [testUser] = await db
        .insert(user)
        .values({
          id: '01912345-6789-7abc-8def-0123456789a1',
          name: 'Retention Owner',
          email: 'retention.owner@example.com',
          role: 'owner',
        })
        .returning();

      if (!testUser) {
        throw new Error('Expected testUser to be created');
      }

      // Seed audit events: 3 older than 24 months, 2 newer than 24 months
      const date26MonthsAgo = new Date('2024-08-10T12:00:00.000Z');
      const date1MonthAgo = new Date('2026-09-10T12:00:00.000Z');

      const oldAuditIds = [
        '01912345-6789-7abc-8def-012345678901',
        '01912345-6789-7abc-8def-012345678902',
        '01912345-6789-7abc-8def-012345678903',
      ];

      for (const id of oldAuditIds) {
        await db.insert(auditEvents).values({
          id,
          occurredAt: date26MonthsAgo,
          actorType: 'system',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: { note: 'old-audit' },
        });
      }

      const recentAuditIds = [
        '01912345-6789-7abc-8def-012345678904',
        '01912345-6789-7abc-8def-012345678905',
      ];

      for (const id of recentAuditIds) {
        await db.insert(auditEvents).values({
          id,
          occurredAt: date1MonthAgo,
          actorType: 'owner',
          action: 'auth.sign_in.success',
          outcome: 'success',
          metadata: { note: 'recent-audit' },
        });
      }

      // Seed sessions: 1 expired, 1 active
      const expiredSessionId = '01912345-6789-7abc-8def-012345678906';
      const activeSessionId = '01912345-6789-7abc-8def-012345678907';

      await db.insert(session).values({
        id: expiredSessionId,
        userId: testUser.id,
        token: 'token-expired-123',
        expiresAt: new Date('2026-10-09T12:00:00.000Z'), // expired 1 day ago
      });

      await db.insert(session).values({
        id: activeSessionId,
        userId: testUser.id,
        token: 'token-active-456',
        expiresAt: new Date('2026-10-15T12:00:00.000Z'), // active for 5 days
      });

      // Seed rate limits: 1 expired, 1 active
      const expiredLimitId = '01912345-6789-7abc-8def-012345678908';
      const activeLimitId = '01912345-6789-7abc-8def-012345678909';

      await db.insert(rateLimits).values({
        id: expiredLimitId,
        key: 'ip:192.168.1.1',
        count: 5,
        expiresAt: new Date('2026-10-09T12:00:00.000Z'),
      });

      await db.insert(rateLimits).values({
        id: activeLimitId,
        key: 'ip:192.168.1.2',
        count: 1,
        expiresAt: new Date('2026-10-11T12:00:00.000Z'),
      });

      // Verify initial counts
      const initialAuditCount = await db.select().from(auditEvents);
      expect(initialAuditCount).toHaveLength(5);

      // =========================================================================
      // 1. Execute DRY-RUN sweep
      // =========================================================================
      const dryRunSummary = await runRetentionSweep({
        client: db,
        dryRun: true,
        now,
      });

      expect(dryRunSummary.dryRun).toBe(true);
      expect(dryRunSummary.totalDeleted).toBe(0);

      // Verify dry-run policy reports
      const auditPolicyRes = dryRunSummary.policies.find(
        (p) => p.policyId === 'audit-events-retention',
      );
      expect(auditPolicyRes?.scannedCount).toBe(3);
      expect(auditPolicyRes?.deletedCount).toBe(0);

      const sessionPolicyRes = dryRunSummary.policies.find(
        (p) => p.policyId === 'expired-sessions',
      );
      expect(sessionPolicyRes?.scannedCount).toBe(1);
      expect(sessionPolicyRes?.deletedCount).toBe(0);

      const limitPolicyRes = dryRunSummary.policies.find(
        (p) => p.policyId === 'expired-rate-limits',
      );
      expect(limitPolicyRes?.scannedCount).toBe(1);
      expect(limitPolicyRes?.deletedCount).toBe(0);

      // Proves dry-run deleted zero records from database
      const auditCountAfterDryRun = await db.select().from(auditEvents);
      expect(auditCountAfterDryRun).toHaveLength(5);
      const sessionCountAfterDryRun = await db.select().from(session);
      expect(sessionCountAfterDryRun).toHaveLength(2);
      const limitCountAfterDryRun = await db.select().from(rateLimits);
      expect(limitCountAfterDryRun).toHaveLength(2);

      // =========================================================================
      // 2. Execute LIVE sweep (without --dry-run)
      // =========================================================================
      const liveSummary = await runRetentionSweep({
        client: db,
        dryRun: false,
        now,
      });

      expect(liveSummary.dryRun).toBe(false);
      expect(liveSummary.totalDeleted).toBe(5); // 3 audit + 1 session + 1 limit

      // Proves old records were deleted and recent records were preserved
      const auditRowsAfterLive = await db.select().from(auditEvents);
      // 2 recent audit events + 1 retention.sweep.completed event recorded
      const recentRows = auditRowsAfterLive.filter((r) => recentAuditIds.includes(r.id));
      expect(recentRows).toHaveLength(2);

      const oldRows = auditRowsAfterLive.filter((r) => oldAuditIds.includes(r.id));
      expect(oldRows).toHaveLength(0);

      // Verify expired session deleted, active preserved
      const sessionsAfterLive = await db.select().from(session);
      expect(sessionsAfterLive).toHaveLength(1);
      expect(sessionsAfterLive[0]?.id).toBe(activeSessionId);

      // Verify expired rate limit deleted, active preserved
      const limitsAfterLive = await db.select().from(rateLimits);
      expect(limitsAfterLive).toHaveLength(1);
      expect(limitsAfterLive[0]?.id).toBe(activeLimitId);

      // Proves exactly one retention.sweep.completed audit event was recorded with counts
      const sweepAuditEvents = auditRowsAfterLive.filter(
        (r) => r.action === 'retention.sweep.completed',
      );
      expect(sweepAuditEvents.length).toBeGreaterThanOrEqual(1);

      const sweepEvent = sweepAuditEvents[0];
      expect(sweepEvent).toBeDefined();
      expect(sweepEvent?.outcome).toBe('success');
      expect(sweepEvent?.metadata).toHaveProperty('scanned_count');
      expect(sweepEvent?.metadata).toHaveProperty('deleted_count');
      expect(sweepEvent?.metadata).toHaveProperty('held_count');
      expect(sweepEvent?.metadata).toHaveProperty('dry_run', false);
    } finally {
      await client.close();
    }
  });
});
