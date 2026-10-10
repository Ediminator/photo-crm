#!/usr/bin/env node
/**
 * scripts/retention-sweep.mjs
 * Executes data retention policies (storage limitation - GDPR Art. 5(1)(e)).
 *
 * Supports:
 *   --dry-run: reports matching counts per policy without deleting or mutating records.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { lt, inArray } from 'drizzle-orm';
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
 * Runs the retention sweep against the configured database.
 * @param {{
 *   connectionUrl?: string,
 *   dbClient?: any,
 *   dryRun?: boolean,
 *   retentionMonths?: number,
 *   now?: Date
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
      options.connectionUrl ||
      process.env.DATABASE_RETENTION_URL ||
      process.env.DATABASE_MIGRATOR_URL ||
      process.env.DATABASE_URL ||
      'postgres://photo_crm_migrator:password@127.0.0.1:5432/photo_crm_dev';

    rawClient = postgres(url, { max: 1, onnotice: () => {} });
    client = drizzle(rawClient);
  }

  const results = {
    dryRun,
    auditEvents: { scanned: 0, deleted: 0, held: 0 },
    sessions: { scanned: 0, deleted: 0, held: 0 },
    rateLimits: { scanned: 0, deleted: 0, held: 0 },
  };

  try {
    // 1. Audit events policy
    const oldAuditEvents = await client
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(lt(auditEvents.occurredAt, auditCutoff));

    results.auditEvents.scanned = oldAuditEvents.length;
    if (!dryRun && oldAuditEvents.length > 0) {
      const ids = oldAuditEvents.map((r) => r.id);
      await client.transaction(async (tx) => {
        await tx.delete(auditEvents).where(inArray(auditEvents.id, ids));
      });
      results.auditEvents.deleted = ids.length;
    } else {
      results.auditEvents.deleted = 0;
    }

    // 2. Expired sessions policy
    const expiredSessions = await client
      .select({ id: session.id })
      .from(session)
      .where(lt(session.expiresAt, now));

    results.sessions.scanned = expiredSessions.length;
    if (!dryRun && expiredSessions.length > 0) {
      const ids = expiredSessions.map((r) => r.id);
      await client.transaction(async (tx) => {
        await tx.delete(session).where(inArray(session.id, ids));
      });
      results.sessions.deleted = ids.length;
    } else {
      results.sessions.deleted = 0;
    }

    // 3. Expired rate limits policy
    const expiredLimits = await client
      .select({ id: rateLimits.id })
      .from(rateLimits)
      .where(lt(rateLimits.expiresAt, now));

    results.rateLimits.scanned = expiredLimits.length;
    if (!dryRun && expiredLimits.length > 0) {
      const ids = expiredLimits.map((r) => r.id);
      await client.transaction(async (tx) => {
        await tx.delete(rateLimits).where(inArray(rateLimits.id, ids));
      });
      results.rateLimits.deleted = ids.length;
    } else {
      results.rateLimits.deleted = 0;
    }

    // Record audit event when mutations took place (non dry-run)
    if (!dryRun) {
      const totalDeleted =
        results.auditEvents.deleted + results.sessions.deleted + results.rateLimits.deleted;

      await client.insert(auditEvents).values({
        id: crypto.randomUUID(),
        occurredAt: new Date(),
        actorType: 'system',
        actorId: 'retention-sweep-cli',
        action: 'retention.sweep.completed',
        targetType: 'system',
        outcome: 'success',
        metadata: {
          scanned_count:
            results.auditEvents.scanned + results.sessions.scanned + results.rateLimits.scanned,
          deleted_count: totalDeleted,
          held_count: 0,
          dry_run: false,
          policies: [
            { id: 'audit-events-retention', deleted: results.auditEvents.deleted },
            { id: 'expired-sessions', deleted: results.sessions.deleted },
            { id: 'expired-rate-limits', deleted: results.rateLimits.deleted },
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
      `  - Audit events: ${results.auditEvents.scanned} scanned, ${results.auditEvents.deleted} deleted`,
    );
    console.log(
      `  - Sessions:     ${results.sessions.scanned} scanned, ${results.sessions.deleted} deleted`,
    );
    console.log(
      `  - Rate limits:  ${results.rateLimits.scanned} scanned, ${results.rateLimits.deleted} deleted`,
    );
    process.exit(0);
  } catch (err) {
    console.error('❌ Retention sweep failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
