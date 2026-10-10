import type { ActorType, AuditOutcome, AuditEvent } from '@/server/db/schema/audit';

export type { ActorType, AuditOutcome, AuditEvent };

export class AuditMetadataValidationError extends Error {
  public readonly forbiddenKeys: readonly string[];
  public readonly action: string;

  constructor(action: string, forbiddenKeys: readonly string[]) {
    super(
      `Audit metadata validation failed for action "${action}": keys [${forbiddenKeys.join(', ')}] are not permitted by allowlist.`,
    );
    this.name = 'AuditMetadataValidationError';
    this.action = action;
    this.forbiddenKeys = Object.freeze([...forbiddenKeys]);
  }
}

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown> | null;
}
