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
import {
  setupOwnerAction,
  signInAction,
  signOutAction,
  getOwnerSessionInfoAction,
} from '@/server/auth/actions';
import {
  startTotpEnrolmentAction,
  verifyAndEnableTotpAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  reauthenticateAction,
  verifyMfaTotpAction,
  verifyMfaRecoveryCodeAction,
  deletePasskeyAction,
} from '@/server/auth/mfa-actions';
import { generateTotpCode } from '@/server/auth/totp';
import { totpCredential, recoveryCode, passkeyCredential, session } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import type { DbClient } from '@/server/db/client';
import { eq } from 'drizzle-orm';

describe('AC-1, AC-2, AC-3, AC-4, AC-6: MFA Integration Suite', () => {
  let testDb: TestDatabaseInstance;
  const validSetupToken = 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';
  const ownerEmail = 'mfa-owner@example.com';
  const ownerPassword = 'ValidOwnerPassword123!';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.SETUP_TOKEN = validSetupToken;
    process.env.AUTH_SECRET = 'a'.repeat(64);
    mockCookiesStore.clear();

    const dbClient = testDb.db as unknown as DbClient;
    // Bootstrap initial owner
    const setupRes = await setupOwnerAction(
      {
        setupToken: validSetupToken,
        name: 'MFA Owner',
        email: ownerEmail,
        password: ownerPassword,
      },
      dbClient,
    );
    expect(setupRes.success).toBe(true);
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: given TOTP enrolment, wrong first code rejects activation; correct code activates and displays recovery codes once', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Start TOTP enrolment
    const startRes = await startTotpEnrolmentAction(dbClient);
    expect(startRes.success).toBe(true);
    expect(startRes.data?.secret).toBeDefined();
    expect(startRes.data?.qrSvg).toContain('<svg');
    const secret = startRes.data?.secret ?? '';

    // Verify database record has verified = false
    const pendingRows = await dbClient.select().from(totpCredential);
    expect(pendingRows.length).toBe(1);
    expect(pendingRows[0]?.verified).toBe(false);

    // 2. Submit wrong first code -> must be rejected and NOT activated
    const badVerify = await verifyAndEnableTotpAction({ code: '000000' }, dbClient);
    expect(badVerify.success).toBe(false);
    expect(badVerify.error).toContain('Invalid verification code');

    const stillPending = await dbClient.select().from(totpCredential);
    expect(stillPending[0]?.verified).toBe(false);

    // No recovery codes generated yet
    const recoveryRowsBefore = await dbClient.select().from(recoveryCode);
    expect(recoveryRowsBefore.length).toBe(0);

    // 3. Submit valid current code -> activates and returns 10 recovery codes
    const validCode = generateTotpCode(secret);
    const goodVerify = await verifyAndEnableTotpAction({ code: validCode }, dbClient);
    expect(goodVerify.success).toBe(true);
    expect(goodVerify.data?.recoveryCodes).toHaveLength(10);

    // Database record is now verified = true
    const activeRows = await dbClient.select().from(totpCredential);
    expect(activeRows[0]?.verified).toBe(true);

    // 10 hashed recovery codes stored
    const recoveryRowsAfter = await dbClient.select().from(recoveryCode);
    expect(recoveryRowsAfter.length).toBe(10);

    // Studio setting mfa_required set to true
    const settings = await dbClient.select().from(studioSettings);
    expect(settings[0]?.mfa_required).toBe(true);

    // 4. Starting enrolment again when already active returns error
    const repeatStart = await startTotpEnrolmentAction(dbClient);
    expect(repeatStart.success).toBe(false);
    expect(repeatStart.error).toContain('already enabled');
  });

  it('AC-2: given active TOTP, sign-in requires valid TOTP; replay of code within current window is rejected', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Enrol TOTP
    const startRes = await startTotpEnrolmentAction(dbClient);
    const secret = startRes.data?.secret ?? '';
    const validCode = generateTotpCode(secret);
    await verifyAndEnableTotpAction({ code: validCode }, dbClient);

    // 2. Sign out
    await signOutAction(dbClient);
    mockCookiesStore.clear();

    // 3. Sign in with email and password -> must return mfaRequired: true and mfaTicket without establishing session
    const signInRes = await signInAction(
      {
        email: ownerEmail,
        password: ownerPassword,
      },
      dbClient,
    );
    expect(signInRes.success).toBe(true);
    expect(signInRes.data?.mfaRequired).toBe(true);
    expect(signInRes.data?.mfaTicket).toBeDefined();

    // Protected action must be unauthorized because no session cookie was set
    await expect(getOwnerSessionInfoAction(dbClient)).rejects.toThrow('Authentication required');

    const mfaTicket = signInRes.data?.mfaTicket ?? '';

    // 4. Submit invalid TOTP code -> rejected
    const badMfa = await verifyMfaTotpAction({ mfaTicket, code: '111111' }, dbClient);
    expect(badMfa.success).toBe(false);
    expect(badMfa.error).toContain('Invalid or replayed');

    // 5. Submit valid TOTP code for the next time-step
    const currentStep = Math.floor(Date.now() / 30000);
    const nextStepCode = generateTotpCode(secret, currentStep + 1);
    const goodMfa = await verifyMfaTotpAction({ mfaTicket, code: nextStepCode }, dbClient);
    expect(goodMfa.success).toBe(true);
    expect(goodMfa.data?.user.email).toBe(ownerEmail);

    // Now protected action succeeds
    const sessionInfo = await getOwnerSessionInfoAction(dbClient);
    expect(sessionInfo.success).toBe(true);
    expect(sessionInfo.data?.user.role).toBe('owner');

    // 6. REPLAY TEST: Sign in again, and attempt to reuse the exact same code
    const signInRes2 = await signInAction(
      {
        email: ownerEmail,
        password: ownerPassword,
      },
      dbClient,
    );
    const mfaTicket2 = signInRes2.data?.mfaTicket ?? '';

    const replayAttempt = await verifyMfaTotpAction(
      { mfaTicket: mfaTicket2, code: nextStepCode },
      dbClient,
    );
    expect(replayAttempt.success).toBe(false);
    expect(replayAttempt.error).toContain('Invalid or replayed');
  });

  it('AC-3: recovery code works once and is consumed; regenerating invalidates prior codes', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Enrol TOTP to get recovery codes
    const startRes = await startTotpEnrolmentAction(dbClient);
    const secret = startRes.data?.secret ?? '';
    const enableRes = await verifyAndEnableTotpAction({ code: generateTotpCode(secret) }, dbClient);
    const originalRecoveryCodes = enableRes.data?.recoveryCodes ?? [];

    // 2. Sign out
    await signOutAction(dbClient);
    mockCookiesStore.clear();

    // 3. Sign in with password
    const signInRes = await signInAction({ email: ownerEmail, password: ownerPassword }, dbClient);
    const mfaTicket = signInRes.data?.mfaTicket ?? '';

    // 4. Use first recovery code
    const firstCode = originalRecoveryCodes[0] ?? '';
    const recoveryVerify = await verifyMfaRecoveryCodeAction(
      { mfaTicket, recoveryCode: firstCode },
      dbClient,
    );
    expect(recoveryVerify.success).toBe(true);
    expect(recoveryVerify.data?.user.email).toBe(ownerEmail);

    // 5. Try reusing the exact same recovery code
    await signOutAction(dbClient);
    mockCookiesStore.clear();

    const signInRes2 = await signInAction({ email: ownerEmail, password: ownerPassword }, dbClient);
    const mfaTicket2 = signInRes2.data?.mfaTicket ?? '';

    const reuseAttempt = await verifyMfaRecoveryCodeAction(
      { mfaTicket: mfaTicket2, recoveryCode: firstCode },
      dbClient,
    );
    expect(reuseAttempt.success).toBe(false);
    expect(reuseAttempt.error).toContain('Invalid recovery code');

    // 6. Sign in with second recovery code to regenerate codes
    const secondCode = originalRecoveryCodes[1] ?? '';
    const signInWithSecond = await verifyMfaRecoveryCodeAction(
      { mfaTicket: mfaTicket2, recoveryCode: secondCode },
      dbClient,
    );
    expect(signInWithSecond.success).toBe(true);

    // 7. Regenerate recovery codes
    const regenRes = await regenerateRecoveryCodesAction(dbClient);
    expect(regenRes.success).toBe(true);
    const newRecoveryCodes = regenRes.data?.recoveryCodes ?? [];
    expect(newRecoveryCodes).toHaveLength(10);

    // 8. Old codes (e.g. third code) must now be invalidated
    await signOutAction(dbClient);
    mockCookiesStore.clear();

    const signInRes3 = await signInAction({ email: ownerEmail, password: ownerPassword }, dbClient);
    const mfaTicket3 = signInRes3.data?.mfaTicket ?? '';

    const thirdOriginalCode = originalRecoveryCodes[2] ?? '';
    const oldCodeAttempt = await verifyMfaRecoveryCodeAction(
      { mfaTicket: mfaTicket3, recoveryCode: thirdOriginalCode },
      dbClient,
    );
    expect(oldCodeAttempt.success).toBe(false);
    expect(oldCodeAttempt.error).toContain('Invalid recovery code');

    // 9. New code works
    const newCodeAttempt = await verifyMfaRecoveryCodeAction(
      { mfaTicket: mfaTicket3, recoveryCode: newRecoveryCodes[0] ?? '' },
      dbClient,
    );
    expect(newCodeAttempt.success).toBe(true);
  });

  it('AC-4: given > 5 failed MFA attempts in 15 minutes, verification is throttled', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // Enrol TOTP
    const startRes = await startTotpEnrolmentAction(dbClient);
    const secret = startRes.data?.secret ?? '';
    await verifyAndEnableTotpAction({ code: generateTotpCode(secret) }, dbClient);

    // Sign out & sign in to get ticket
    await signOutAction(dbClient);
    mockCookiesStore.clear();

    const signInRes = await signInAction({ email: ownerEmail, password: ownerPassword }, dbClient);
    const mfaTicket = signInRes.data?.mfaTicket ?? '';

    // 5 failed verification attempts
    for (let i = 0; i < 5; i++) {
      const res = await verifyMfaTotpAction({ mfaTicket, code: `00000${String(i)}` }, dbClient);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid or replayed');
    }

    // 6th attempt must be throttled
    const throttledRes = await verifyMfaTotpAction(
      { mfaTicket, code: generateTotpCode(secret, Math.floor(Date.now() / 30000) + 1) },
      dbClient,
    );
    expect(throttledRes.success).toBe(false);
    expect(throttledRes.error).toContain('Too many failed MFA verification attempts');
  });

  it('AC-6: given disabling TOTP or deleting the last passkey, fresh re-authentication (<= 5 min) is required', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Enrol TOTP
    const startRes = await startTotpEnrolmentAction(dbClient);
    const secret = startRes.data?.secret ?? '';
    await verifyAndEnableTotpAction({ code: generateTotpCode(secret) }, dbClient);

    // 2. Simulate stale session (> 5 minutes since re-auth)
    const activeSessions = await dbClient.select().from(session);
    const currentSession = activeSessions[0];
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

    // 3. Attempting to disable TOTP without fresh re-auth must fail with REAUTH_REQUIRED
    const staleDisable = await disableTotpAction(dbClient);
    expect(staleDisable.success).toBe(false);
    expect(staleDisable.code).toBe('REAUTH_REQUIRED');

    // 4. Re-authenticate with wrong password fails
    const badReauth = await reauthenticateAction({ password: 'WrongPassword999!' }, dbClient);
    expect(badReauth.success).toBe(false);

    // 5. Re-authenticate with correct password succeeds
    const goodReauth = await reauthenticateAction({ password: ownerPassword }, dbClient);
    expect(goodReauth.success).toBe(true);

    // 6. Now disableTotpAction succeeds
    const goodDisable = await disableTotpAction(dbClient);
    expect(goodDisable.success).toBe(true);

    // 7. Verify passkey re-authentication rule (deleting last passkey requires re-auth)
    // Register 2 passkeys directly in DB
    const [userRow] = await dbClient.select().from(session);
    const userId = userRow?.userId ?? '';

    const [pk1] = await dbClient
      .insert(passkeyCredential)
      .values({
        userId,
        name: 'Passkey 1',
        credentialId: 'cred-1',
        publicKey: 'pub-1',
      })
      .returning();

    const [pk2] = await dbClient
      .insert(passkeyCredential)
      .values({
        userId,
        name: 'Passkey 2',
        credentialId: 'cred-2',
        publicKey: 'pub-2',
      })
      .returning();

    // Deleting pk1 when pk2 still exists does NOT require re-auth
    const deletePk1 = await deletePasskeyAction({ passkeyId: pk1?.id ?? '' }, dbClient);
    expect(deletePk1.success).toBe(true);

    // Now only pk2 remains (the LAST passkey).
    // Stale session again (> 5 min)
    await dbClient
      .update(session)
      .set({
        lastReauthenticatedAt: sixMinutesAgo,
      })
      .where(eq(session.id, currentSession.id));

    // Deleting the last passkey with stale session must fail
    const deleteLastStale = await deletePasskeyAction({ passkeyId: pk2?.id ?? '' }, dbClient);
    expect(deleteLastStale.success).toBe(false);
    expect(deleteLastStale.code).toBe('REAUTH_REQUIRED');

    // Re-authenticate
    await reauthenticateAction({ password: ownerPassword }, dbClient);

    // Now deleting the last passkey succeeds
    const deleteLastGood = await deletePasskeyAction({ passkeyId: pk2?.id ?? '' }, dbClient);
    expect(deleteLastGood.success).toBe(true);
  });
});
