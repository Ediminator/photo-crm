import {
  requireAuth,
  type AuthContext,
  type RequireAuthOptions,
  ForbiddenError,
} from '@/server/auth/guards';
import { CLIENTS_READ, CLIENTS_WRITE } from '@/server/auth/scopes';
import { audit } from '@/server/audit';
import type { DbClient } from '@/server/db/client';
import type { ActorType } from '@/server/db/schema/audit';

function isAuthContext(value: unknown): value is AuthContext {
  return value !== null && typeof value === 'object' && 'user' in value;
}

/**
 * Authorizes read access to the clients domain.
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'clients:read' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 */
export async function authorizeClientRead(
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  // 1. Role verification: studio owner only
  if (context.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required to read client resources.');
  }

  // 2. Scope verification
  const hasScope = context.scopes.includes('*') || context.scopes.includes(CLIENTS_READ);
  if (!hasScope) {
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${CLIENTS_READ}`);
  }

  return context;
}

/**
 * Authorizes write access to the clients domain.
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'clients:write' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 * - On authorization denial of an authenticated actor, an audit event with outcome: 'denied' is recorded.
 */
export async function authorizeClientWrite(
  action: string,
  targetId?: string | null,
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  async function recordDeniedAuditEvent() {
    try {
      const actorType: ActorType =
        context.authType === 'apiKey' ? 'token' : (context.user.role as ActorType);

      const actorId =
        context.authType === 'apiKey'
          ? (context.apiKey?.id ?? context.apiKey?.prefix ?? null)
          : context.user.id;

      await audit(
        {
          actorType,
          actorId,
          action,
          targetType: 'client',
          targetId: targetId ?? null,
          outcome: 'denied',
          metadata: null,
        },
        dbClient,
      );
    } catch {
      // Never let audit recording failure mask the authorization denial
    }
  }

  // 1. Role verification: studio owner only
  if (context.user.role !== 'owner') {
    await recordDeniedAuditEvent();
    throw new ForbiddenError('Owner role required to modify client resources.');
  }

  // 2. Scope verification
  const hasScope = context.scopes.includes('*') || context.scopes.includes(CLIENTS_WRITE);
  if (!hasScope) {
    await recordDeniedAuditEvent();
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${CLIENTS_WRITE}`);
  }

  return context;
}
