import 'server-only';
import { eq, and } from 'drizzle-orm';
import { db, type DbClient } from '@/server/db/client';
import { totpCredential, passkeyCredential } from '@/server/db/schema/auth';
import { getStudioSettings } from '@/server/settings/repo';
import { verifySession } from './session';

/**
 * Evaluates whether an authenticated user is subject to forced MFA enrolment (TASK-0008 / AC-8).
 * Returns the destination redirect URL if forced enrolment is triggered, or null otherwise.
 */
export async function checkMfaEnforcement(
  locale: string,
  pathname: string,
  sessionToken?: string | null,
  client: DbClient = db,
): Promise<string | null> {
  if (!sessionToken) return null;

  // If already on the security settings page or an auth ceremony, avoid redirect loop
  if (
    !pathname ||
    pathname.includes('/settings/security') ||
    pathname.includes('/sign-in') ||
    pathname.includes('/setup') ||
    pathname.includes('/forgot-password') ||
    pathname.includes('/reset-password')
  ) {
    return null;
  }

  const verified = await verifySession(sessionToken, client);
  if (!verified) return null;

  const settings = await getStudioSettings(client);
  if (!settings.mfa_required) return null;

  const now = Date.now();
  const postponementExpired =
    !settings.mfa_postponed_until || settings.mfa_postponed_until.getTime() <= now;

  if (!postponementExpired) return null;

  // Check if owner has any active MFA factor (TOTP or Passkey)
  const activeTotp = await client
    .select()
    .from(totpCredential)
    .where(and(eq(totpCredential.userId, verified.user.id), eq(totpCredential.verified, true)))
    .limit(1);

  if (activeTotp.length > 0) return null;

  const passkeys = await client
    .select()
    .from(passkeyCredential)
    .where(eq(passkeyCredential.userId, verified.user.id))
    .limit(1);

  if (passkeys.length > 0) return null;

  // Owner has no MFA configured and postponement has expired -> forced to enrol
  return `/${locale}/settings/security?mfa_enforced=1`;
}
