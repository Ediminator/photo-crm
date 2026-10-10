import { pgTable, uuid, varchar, text, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';

export const ACTOR_TYPES = ['owner', 'client', 'system', 'agent', 'token'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const OUTCOMES = ['success', 'failure', 'denied'] as const;
export type AuditOutcome = (typeof OUTCOMES)[number];

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    actorType: varchar('actor_type', { length: 32 }).notNull().$type<ActorType>(),
    actorId: text('actor_id'),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: varchar('outcome', { length: 32 }).notNull().$type<AuditOutcome>(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_type_idx').on(table.actorType),
    index('audit_events_action_idx').on(table.action),
    check(
      'audit_events_actor_type_check',
      sql`actor_type IN ('owner', 'client', 'system', 'agent', 'token')`,
    ),
    check('audit_events_outcome_check', sql`outcome IN ('success', 'failure', 'denied')`),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
