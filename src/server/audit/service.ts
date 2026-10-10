import 'server-only';
import { db, type DbClient } from '@/server/db/client';
import { auditEvents, type AuditEvent } from '@/server/db/schema/audit';
import { logger } from '@/server/log';
import type { AuditInput } from './types';
import { validateAndSanitizeMetadata } from './allowlist';

/**
 * Dispatches an append-only audit event into the database with schema-enforced
 * actor attribution, outcome tracking, and allowlist-validated metadata.
 */
export async function audit(input: AuditInput, client: DbClient = db): Promise<AuditEvent> {
  const sanitizedMetadata = validateAndSanitizeMetadata(
    input.action,
    input.actorType,
    input.metadata,
  );

  const [record] = await client
    .insert(auditEvents)
    .values({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      metadata: sanitizedMetadata,
    })
    .returning();

  if (!record) {
    throw new Error(`Failed to record audit event for action "${input.action}"`);
  }

  logger.info(
    {
      auditEventId: record.id,
      action: record.action,
      actorType: record.actorType,
      actorId: record.actorId,
      outcome: record.outcome,
    },
    `Audit event recorded: ${record.action} (${record.outcome})`,
  );

  return record;
}
