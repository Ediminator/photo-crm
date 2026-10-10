import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => (name === 'x-real-ip' ? '127.0.0.1' : null),
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { setupOwnerAction } from '@/server/auth/actions';
import {
  startTotpEnrolmentAction,
  verifyAndEnableTotpAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  reauthenticateAction,
} from '@/server/auth/mfa-actions';
import { generateTotpCode } from '@/server/auth/totp';
import { session } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';
import { eq } from 'drizzle-orm';

describe('AC-2: Step-up re-authentication behaviour for sensitive MFA actions', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  const ownerPassword = 'CorrectHorseBatteryStaple2026!';

  beforeEach(async () => {
    mockCookiesStore.clear();
    process.env.SETUP_TOKEN = 'a'.repeat(64);
    process.env.AUTH_SECRET = 'b'.repeat(64);
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    // Bootstrap owner
    const setupRes = await setupOwnerAction(
      {
        setupToken: 'a'.repeat(64),
        name: 'Studio Owner',
        email: 'owner@example.com',
        password: ownerPassword,
      },
      dbClient,
    );
    expect(setupRes.success).toBe(true);
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-2: disableTotpAction fails with REAUTH_REQUIRED when reauth older than 5 minutes, and succeeds within 5 minutes', async () => {
    // 1. Enroll TOTP
    const startRes = await startTotpEnrolmentAction(dbClient);
    expect(startRes.success).toBe(true);
    if (!startRes.success || !startRes.data) {
      throw new Error('Failed to start TOTP enrolment');
    }

    const code = generateTotpCode(startRes.data.secret);
    const enableRes = await verifyAndEnableTotpAction({ code }, dbClient);
    expect(enableRes.success).toBe(true);

    // 2. Age the session's lastReauthenticatedAt past the 5-minute freshness window (6 minutes ago)
    const [currentSession] = await dbClient.select().from(session);
    if (!currentSession) {
      throw new Error('Expected active session');
    }

    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await dbClient
      .update(session)
      .set({
        lastReauthenticatedAt: sixMinutesAgo,
        createdAt: sixMinutesAgo,
      })
      .where(eq(session.id, currentSession.id));

    // 3. disableTotpAction must fail with REAUTH_REQUIRED
    const staleResult = await disableTotpAction(dbClient);
    expect(staleResult.success).toBe(false);
    expect(staleResult.code).toBe('REAUTH_REQUIRED');

    // 4. Re-authenticate to refresh session freshness
    const reauthResult = await reauthenticateAction({ password: ownerPassword }, dbClient);
    expect(reauthResult.success).toBe(true);

    // 5. disableTotpAction within 5 minutes succeeds
    const freshResult = await disableTotpAction(dbClient);
    expect(freshResult.success).toBe(true);
  });

  it('AC-2: regenerateRecoveryCodesAction fails with REAUTH_REQUIRED when reauth older than 5 minutes, and succeeds within 5 minutes', async () => {
    // 1. Enroll TOTP to enable recovery code generation
    const startRes = await startTotpEnrolmentAction(dbClient);
    expect(startRes.success).toBe(true);
    if (!startRes.success || !startRes.data) {
      throw new Error('Failed to start TOTP enrolment');
    }

    const code = generateTotpCode(startRes.data.secret);
    const enableRes = await verifyAndEnableTotpAction({ code }, dbClient);
    expect(enableRes.success).toBe(true);

    // 2. Age session reauth timestamp (6 minutes ago)
    const [currentSession] = await dbClient.select().from(session);
    if (!currentSession) {
      throw new Error('Expected active session');
    }

    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await dbClient
      .update(session)
      .set({
        lastReauthenticatedAt: sixMinutesAgo,
        createdAt: sixMinutesAgo,
      })
      .where(eq(session.id, currentSession.id));

    // 3. regenerateRecoveryCodesAction must fail with REAUTH_REQUIRED
    const staleResult = await regenerateRecoveryCodesAction(dbClient);
    expect(staleResult.success).toBe(false);
    expect(staleResult.code).toBe('REAUTH_REQUIRED');

    // 4. Re-authenticate to refresh session freshness
    const reauthResult = await reauthenticateAction({ password: ownerPassword }, dbClient);
    expect(reauthResult.success).toBe(true);

    // 5. regenerateRecoveryCodesAction within 5 minutes succeeds
    const freshResult = await regenerateRecoveryCodesAction(dbClient);
    expect(freshResult.success).toBe(true);
    if (freshResult.success && freshResult.data) {
      expect(freshResult.data.recoveryCodes.length).toBe(10);
    }
  });
});
