#!/usr/bin/env node
/**
 * scripts/retention-sweep.mjs
 * Canonical CLI runner for data retention policies (storage limitation - GDPR Art. 5(1)(e)).
 *
 * Implements:
 *   - Legal hold evaluation (GDPR Art. 17(3)(b) / GoBD §147 AO)
 *   - Bounded transactional batching (batchSize: 500)
 *   - --dry-run: reports matching counts per policy without deleting or mutating records.
 *   - Summary audit event (retention.sweep.completed) recording counts without subject PII.
 */
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { lt, inArray, and, notInArray } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

const __filename = fileURLToPath(import.meta.url);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  actorType: varchar('actor_type', { length: 32 }).notNull(),
  actorId: text('actor_id'),
  action: varchar('action', { length: 128 }).notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  outcome: varchar('outcome', { length: 32 }).notNull(),
  metadata: jsonb('metadata'),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * Runs the declarative retention sweep against the configured database.
 * @param {{
 *   connectionUrl?: string,
 *   dbClient?: any,
 *   dryRun?: boolean,
 *   retentionMonths?: number,
 *   now?: Date,
 *   batchSize?: number,
 *   legalHold?: (row: any) => boolean | Promise<boolean>,
 *   signal?: AbortSignal
 * }} [options={}]
 */
export async function executeRetentionSweep(options = {}) {
  const dryRun = options.dryRun ?? process.argv.includes('--dry-run');
  const now = options.now ?? new Date();
  const retentionMonths =
    options.retentionMonths ??
    (process.env.RETENTION_PERIOD_MONTHS ? parseInt(process.env.RETENTION_PERIOD_MONTHS, 10) : 24);

  const auditCutoff = new Date(now.getTime());
  auditCutoff.setMonth(auditCutoff.getMonth() - retentionMonths);

  let client = options.dbClient;
  let rawClient = null;

  if (!client) {
    const url =
      options.connectionUrl || process.env.DATABASE_RETENTION_URL || process.env.DATABASE_URL;

    if (!url) {
      throw new Error(
        'Database connection URL missing. Set DATABASE_RETENTION_URL or DATABASE_URL in environment.',
      );
    }

    rawClient = postgres(url, { max: 1, onnotice: () => {} });
    client = drizzle(rawClient);
  }

  const results = {
    dryRun,
    auditEvents: { scanned: 0, deleted: 0, held: 0 },
    sessions: { scanned: 0, deleted: 0, held: 0 },
    rateLimits: { scanned: 0, deleted: 0, held: 0 },
  };

  const defaultLegalHold = (row) => {
    const meta = row.metadata;
    if (meta && typeof meta === 'object') {
      return meta.legal_hold === true;
    }
    return false;
  };

  const legalHoldPredicate = options.legalHold ?? defaultLegalHold;
  const batchSize = options.batchSize ?? 500;

  try {
    // 1. Audit events retention policy (with statutory legal hold and batch chunking)
    let hasMoreAudit = true;
    const excludedAuditIds = [];

    while (hasMoreAudit) {
      if (options.signal?.aborted) break;

      const candidates = await client
        .select()
        .from(auditEvents)
        .where(
          excludedAuditIds.length > 0
            ? and(
                lt(auditEvents.occurredAt, auditCutoff),
                notInArray(auditEvents.id, excludedAuditIds),
              )
            : lt(auditEvents.occurredAt, auditCutoff),
        )
        .limit(batchSize);

      if (candidates.length === 0) {
        break;
      }

      results.auditEvents.scanned += candidates.length;

      const heldRows = [];
      const eligibleRows = [];

      for (const row of candidates) {
        const isHeld = await legalHoldPredicate(row);
        if (isHeld) {
          heldRows.push(row);
          if (!excludedAuditIds.includes(row.id)) {
            excludedAuditIds.push(row.id);
          }
        } else {
          eligibleRows.push(row);
        }
      }

      results.auditEvents.held += heldRows.length;

      if (!dryRun) {
        if (eligibleRows.length > 0) {
          if (options.signal?.aborted) break;

          const eligibleIds = eligibleRows.map((r) => r.id);
          await client.transaction(async (tx) => {
            await tx.delete(auditEvents).where(inArray(auditEvents.id, eligibleIds));
          });
          results.auditEvents.deleted += eligibleIds.length;
        } else if (heldRows.length === candidates.length) {
          // All rows in this batch are under legal hold; continue scanning next batch
        }
      } else {
        for (const r of eligibleRows) {
          if (!excludedAuditIds.includes(r.id)) {
            excludedAuditIds.push(r.id);
          }
        }
      }

      if (candidates.length < batchSize) {
        hasMoreAudit = false;
      }
    }

    // 2. Expired sessions policy
    let hasMoreSessions = true;
    const excludedSessionIds = [];

    while (hasMoreSessions) {
      if (options.signal?.aborted) break;

      const candidates = await client
        .select({ id: session.id })
        .from(session)
        .where(
          excludedSessionIds.length > 0
            ? and(lt(session.expiresAt, now), notInArray(session.id, excludedSessionIds))
            : lt(session.expiresAt, now),
        )
        .limit(1000);

      if (candidates.length === 0) {
        break;
      }

      results.sessions.scanned += candidates.length;

      if (!dryRun) {
        const ids = candidates.map((r) => r.id);
        await client.transaction(async (tx) => {
          await tx.delete(session).where(inArray(session.id, ids));
        });
        results.sessions.deleted += ids.length;
      } else {
        for (const r of candidates) {
          if (!excludedSessionIds.includes(r.id)) {
            excludedSessionIds.push(r.id);
          }
        }
      }

      if (candidates.length < 1000) {
        hasMoreSessions = false;
      }
    }

    // 3. Expired rate limits policy
    let hasMoreLimits = true;
    const excludedLimitIds = [];

    while (hasMoreLimits) {
      if (options.signal?.aborted) break;

      const candidates = await client
        .select({ id: rateLimits.id })
        .from(rateLimits)
        .where(
          excludedLimitIds.length > 0
            ? and(lt(rateLimits.expiresAt, now), notInArray(rateLimits.id, excludedLimitIds))
            : lt(rateLimits.expiresAt, now),
        )
        .limit(1000);

      if (candidates.length === 0) {
        break;
      }

      results.rateLimits.scanned += candidates.length;

      if (!dryRun) {
        const ids = candidates.map((r) => r.id);
        await client.transaction(async (tx) => {
          await tx.delete(rateLimits).where(inArray(rateLimits.id, ids));
        });
        results.rateLimits.deleted += ids.length;
      } else {
        for (const r of candidates) {
          if (!excludedLimitIds.includes(r.id)) {
            excludedLimitIds.push(r.id);
          }
        }
      }

      if (candidates.length < 1000) {
        hasMoreLimits = false;
      }
    }

    // Record audit event when mutations took place (non dry-run)
    if (!dryRun) {
      const totalDeleted =
        results.auditEvents.deleted + results.sessions.deleted + results.rateLimits.deleted;
      const totalScanned =
        results.auditEvents.scanned + results.sessions.scanned + results.rateLimits.scanned;
      const totalHeld = results.auditEvents.held + results.sessions.held + results.rateLimits.held;

      await client.insert(auditEvents).values({
        id: crypto.randomUUID(),
        occurredAt: new Date(),
        actorType: 'system',
        actorId: 'retention-sweep-cli',
        action: 'retention.sweep.completed',
        targetType: 'system',
        outcome: 'success',
        metadata: {
          scanned_count: totalScanned,
          deleted_count: totalDeleted,
          held_count: totalHeld,
          dry_run: false,
          policies: [
            {
              id: 'audit-events-retention',
              scanned: results.auditEvents.scanned,
              deleted: results.auditEvents.deleted,
              held: results.auditEvents.held,
            },
            {
              id: 'expired-sessions',
              scanned: results.sessions.scanned,
              deleted: results.sessions.deleted,
              held: results.sessions.held,
            },
            {
              id: 'expired-rate-limits',
              scanned: results.rateLimits.scanned,
              deleted: results.rateLimits.deleted,
              held: results.rateLimits.held,
            },
          ],
        },
      });
    }

    return results;
  } finally {
    if (rawClient) {
      await rawClient.end();
    }
  }
}

if (process.argv[1] === __filename) {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    console.log(`🧹 Running retention sweep (${isDryRun ? 'DRY-RUN' : 'LIVE'})...`);
    const results = await executeRetentionSweep();
    console.log('✅ Retention sweep finished:');
    console.log(
      `  - Audit events: ${results.auditEvents.scanned} scanned, ${results.auditEvents.deleted} deleted, ${results.auditEvents.held} held`,
    );
    console.log(
      `  - Sessions:     ${results.sessions.scanned} scanned, ${results.sessions.deleted} deleted, ${results.sessions.held} held`,
    );
    console.log(
      `  - Rate limits:  ${results.rateLimits.scanned} scanned, ${results.rateLimits.deleted} deleted, ${results.rateLimits.held} held`,
    );
    process.exit(0);
  } catch (err) {
    console.error('❌ Retention sweep failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
