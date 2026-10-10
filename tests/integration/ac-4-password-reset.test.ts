import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  requestPasswordReset,
  resetPassword,
  GENERIC_RESET_RESPONSE,
  hashResetToken,
} from '@/server/auth/password-reset';
import { user, account, session, verification } from '@/server/db/schema/auth';
import { verifyPasswordArgon2id, hashPasswordArgon2id } from '@/server/auth/passwords/policy';
import type { DbClient } from '@/server/db/client';
import { eq } from 'drizzle-orm';

describe('AC-4: Password reset generic timing-equalised response and token lifecycle', () => {
  let testDb: TestDatabaseInstance;
  const sentEmails: { to: string; subject: string; text: string }[] = [];

  const mockTransporter = {
    sendMail: (options: { to: string; subject: string; text: string }) => {
      sentEmails.push(options);
      return Promise.resolve({ messageId: 'test-msg-id' });
    },
  } as unknown as import('nodemailer').Transporter;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    sentEmails.length = 0;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-4: returns identical generic response in body and status for known vs unknown email', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // Seed a known owner user
    const initialPassword = 'InitialOwnerPassword123!';
    const passwordHash = await hashPasswordArgon2id(initialPassword);

    const [createdUser] = await dbClient
      .insert(user)
      .values({
        name: 'Known Owner',
        email: 'known-owner@example.com',
        role: 'owner',
      })
      .returning();

    expect(createdUser).toBeDefined();
    if (!createdUser) throw new Error('Expected createdUser to be defined');

    await dbClient.insert(account).values({
      accountId: 'known-owner@example.com',
      providerId: 'credential',
      userId: createdUser.id,
      password: passwordHash,
    });

    // 1. Request for known email
    const knownRes = await requestPasswordReset('known-owner@example.com', {
      transporter: mockTransporter,
      client: dbClient,
    });

    // 2. Request for unknown email
    const unknownRes = await requestPasswordReset('non-existent-user@example.com', {
      transporter: mockTransporter,
      client: dbClient,
    });

    // Responses must be strictly equal
    expect(knownRes).toEqual(GENERIC_RESET_RESPONSE);
    expect(unknownRes).toEqual(GENERIC_RESET_RESPONSE);
    expect(knownRes.message).toBe(unknownRes.message);

    // Known email received reset email
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0]?.to).toBe('known-owner@example.com');
    expect(sentEmails[0]?.text).toContain('/reset-password?token=');

    // Extract token from email and verify stored hash
    const tokenMatch = sentEmails[0]?.text.match(/token=([0-9a-fA-F]+)/);
    expect(tokenMatch).not.toBeNull();
    const rawToken = tokenMatch?.[1] ?? '';
    const expectedHash = hashResetToken(rawToken);

    const storedTokens = await dbClient
      .select()
      .from(verification)
      .where(eq(verification.identifier, 'known-owner@example.com'));

    expect(storedTokens.length).toBe(1);
    expect(storedTokens[0]?.value).toBe(expectedHash);
  });

  it('AC-4: resets password successfully with valid token and enforces single-use', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const initialPassword = 'InitialOwnerPassword123!';
    const [createdUser] = await dbClient
      .insert(user)
      .values({
        name: 'Owner Two',
        email: 'owner2@example.com',
        role: 'owner',
      })
      .returning();

    expect(createdUser).toBeDefined();
    if (!createdUser) throw new Error('Expected createdUser to be defined');

    await dbClient.insert(account).values({
      accountId: 'owner2@example.com',
      providerId: 'credential',
      userId: createdUser.id,
      password: await hashPasswordArgon2id(initialPassword),
    });

    // Create an active session that should be invalidated upon reset
    await dbClient.insert(session).values({
      userId: createdUser.id,
      token: 'session-token-to-revoke',
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Request reset
    await requestPasswordReset('owner2@example.com', {
      transporter: mockTransporter,
      client: dbClient,
    });

    const tokenMatch = sentEmails[0]?.text.match(/token=([0-9a-fA-F]+)/);
    expect(tokenMatch).not.toBeNull();
    const rawToken = tokenMatch?.[1] ?? '';

    // Reset password with new password
    const newPassword = 'NewSecretPassword2026!';
    const resetResult = await resetPassword({
      email: 'owner2@example.com',
      token: rawToken,
      newPassword,
      client: dbClient,
    });

    expect(resetResult.success).toBe(true);

    // Check new password verified with Argon2id
    const updatedAccount = await dbClient
      .select()
      .from(account)
      .where(eq(account.userId, createdUser.id));
    const firstAcc = updatedAccount[0];
    expect(firstAcc?.password).toBeDefined();
    if (firstAcc?.password) {
      expect(await verifyPasswordArgon2id(firstAcc.password, newPassword)).toBe(true);
    }

    // Verify session revoked
    const activeSessions = await dbClient
      .select()
      .from(session)
      .where(eq(session.userId, createdUser.id));
    expect(activeSessions.length).toBe(0);

    // Attempting to replay the single-use token must fail
    await expect(
      resetPassword({
        email: 'owner2@example.com',
        token: rawToken,
        newPassword: 'AnotherPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow('Invalid or expired password reset link.');
  });

  it('AC-4: rejects expired password reset token (> 30 min)', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [createdUser] = await dbClient
      .insert(user)
      .values({
        name: 'Owner Three',
        email: 'owner3@example.com',
        role: 'owner',
      })
      .returning();

    expect(createdUser).toBeDefined();
    if (!createdUser) throw new Error('Expected createdUser to be defined');

    await dbClient.insert(account).values({
      accountId: 'owner3@example.com',
      providerId: 'credential',
      userId: createdUser.id,
      password: await hashPasswordArgon2id('OldPassword123!'),
    });

    // Insert an expired token (expired 5 minutes ago)
    const rawToken = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    await dbClient.insert(verification).values({
      identifier: 'owner3@example.com',
      value: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    await expect(
      resetPassword({
        email: 'owner3@example.com',
        token: rawToken,
        newPassword: 'BrandNewValidPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow('Invalid or expired password reset link.');
  });

  it('AC-4: resetPassword rejects new password that violates password policy', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    await expect(
      resetPassword({
        email: 'owner@example.com',
        token: 'raw-token',
        newPassword: 'short',
        client: dbClient,
      }),
    ).rejects.toThrow('Password must be at least 12 characters long.');
  });
});
