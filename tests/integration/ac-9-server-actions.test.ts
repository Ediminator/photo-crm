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
  signOutEverywhereAction,
  requestPasswordResetAction,
  resetPasswordAction,
  getOwnerSessionInfoAction,
} from '@/server/auth/actions';
import { verification } from '@/server/db/schema/auth';
import { hashResetToken } from '@/server/auth/password-reset';
import type { DbClient } from '@/server/db/client';

describe('AC-9: Server Actions Execution, Authorization, and Session Lifecycle', () => {
  let testDb: TestDatabaseInstance;
  const validSetupToken = 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';
  const originalSetupToken = process.env.SETUP_TOKEN;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.SETUP_TOKEN = validSetupToken;
    mockCookiesStore.clear();
  }, 30000);

  afterEach(async () => {
    process.env.SETUP_TOKEN = originalSetupToken;
    await testDb.destroy();
  });

  it('AC-9: executes setupOwnerAction, signInAction, and protected getOwnerSessionInfoAction', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. setupOwnerAction fails with invalid token
    const badSetup = await setupOwnerAction(
      {
        setupToken: 'invalid_token_123',
        name: 'Studio Owner',
        email: 'owner@example.com',
        password: 'ValidPassword123!',
      },
      dbClient,
    );
    expect(badSetup.success).toBe(false);
    expect(badSetup.error).toBeDefined();

    // 2. setupOwnerAction succeeds with valid token
    const goodSetup = await setupOwnerAction(
      {
        setupToken: validSetupToken,
        name: 'Studio Owner',
        email: 'owner@example.com',
        password: 'ValidPassword123!',
      },
      dbClient,
    );
    expect(goodSetup.success).toBe(true);
    expect(goodSetup.data?.user.email).toBe('owner@example.com');

    // Verify session cookie was set
    const sessionCookie =
      mockCookiesStore.get('photo_crm_session') ??
      mockCookiesStore.get('__Secure-photo_crm_session');
    expect(sessionCookie).toBeDefined();

    // 3. getOwnerSessionInfoAction succeeds when cookie is present
    const sessionInfo = await getOwnerSessionInfoAction(dbClient);
    expect(sessionInfo.success).toBe(true);
    expect(sessionInfo.data?.user.role).toBe('owner');

    // 4. signOutAction revokes session and clears cookie
    const signOutRes = await signOutAction(dbClient);
    expect(signOutRes.success).toBe(true);
    expect(mockCookiesStore.size).toBe(0);

    // 5. getOwnerSessionInfoAction fails after sign out (unauthorized)
    await expect(getOwnerSessionInfoAction(dbClient)).rejects.toThrow(
      'Authentication required. No session or API key provided.',
    );

    // 6. signInAction fails with wrong password
    const badSignIn = await signInAction(
      {
        email: 'owner@example.com',
        password: 'WrongPassword999!',
      },
      dbClient,
    );
    expect(badSignIn.success).toBe(false);
    expect(badSignIn.error).toBe('Invalid email or password.');

    // 6b. signInAction fails with unknown email
    const unknownSignIn = await signInAction(
      {
        email: 'unknown-user@example.com',
        password: 'ValidPassword123!',
      },
      dbClient,
    );
    expect(unknownSignIn.success).toBe(false);
    expect(unknownSignIn.error).toBe('Invalid email or password.');

    // 7. signInAction succeeds with correct password
    const goodSignIn = await signInAction(
      {
        email: 'owner@example.com',
        password: 'ValidPassword123!',
      },
      dbClient,
    );
    expect(goodSignIn.success).toBe(true);
    expect(goodSignIn.data?.user.email).toBe('owner@example.com');

    // 8. signOutEverywhereAction invalidates all sessions
    const signOutAllRes = await signOutEverywhereAction(dbClient);
    expect(signOutAllRes.success).toBe(true);
    expect(mockCookiesStore.size).toBe(0);

    // 9. signOutAction when no session cookie exists
    const noSessionSignOut = await signOutAction(dbClient);
    expect(noSessionSignOut.success).toBe(true);
  });

  it('AC-9: executes requestPasswordResetAction and resetPasswordAction', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // Bootstrap owner
    await setupOwnerAction(
      {
        setupToken: validSetupToken,
        name: 'Reset Owner',
        email: 'reset-owner@example.com',
        password: 'OriginalPassword123!',
      },
      dbClient,
    );

    // 1. requestPasswordResetAction returns generic message
    const mockTransporter = {
      sendMail: () => Promise.resolve({ messageId: 'mock-msg' }),
    } as unknown as import('nodemailer').Transporter;

    const resetReq = await requestPasswordResetAction(
      { email: 'reset-owner@example.com' },
      { client: dbClient, transporter: mockTransporter },
    );
    expect(resetReq.success).toBe(true);
    expect(resetReq.data?.message).toContain('password reset link has been dispatched');

    // 2. Insert valid reset token directly for reset verification
    const rawToken = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    await dbClient.insert(verification).values({
      identifier: 'reset-owner@example.com',
      value: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // 3. resetPasswordAction succeeds with valid token and new password
    const resetRes = await resetPasswordAction(
      {
        email: 'reset-owner@example.com',
        token: rawToken,
        newPassword: 'BrandNewSecurePassword2026!',
      },
      dbClient,
    );
    expect(resetRes.success).toBe(true);

    // 3b. resetPasswordAction fails with invalid token
    const badReset = await resetPasswordAction(
      {
        email: 'reset-owner@example.com',
        token: 'completely-invalid-token-1234',
        newPassword: 'BrandNewSecurePassword2026!',
      },
      dbClient,
    );
    expect(badReset.success).toBe(false);
    expect(badReset.error).toBe('Invalid or expired password reset link.');

    // 4. Verify sign in works with new password
    const signInNew = await signInAction(
      {
        email: 'reset-owner@example.com',
        password: 'BrandNewSecurePassword2026!',
      },
      dbClient,
    );
    expect(signInNew.success).toBe(true);
  });

  it('AC-9: requireOwner throws ForbiddenError when authenticated user is not an owner', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const { user, session } = await import('@/server/db/schema/auth');
    const { requireOwner } = await import('@/server/auth/guards');

    const [nonOwner] = await dbClient
      .insert(user)
      .values({
        name: 'Staff Member',
        email: 'staff@example.com',
        role: 'staff',
      })
      .returning();

    expect(nonOwner).toBeDefined();
    if (!nonOwner) throw new Error('Expected nonOwner to be defined');

    const [nonOwnerSession] = await dbClient
      .insert(session)
      .values({
        userId: nonOwner.id,
        token: 'staff-session-token-xyz',
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();

    expect(nonOwnerSession).toBeDefined();
    if (!nonOwnerSession) throw new Error('Expected nonOwnerSession to be defined');

    mockCookiesStore.set('photo_crm_session', nonOwnerSession.token);

    await expect(requireOwner({ client: dbClient })).rejects.toThrow(
      'Owner role required for this action.',
    );
  });
});
