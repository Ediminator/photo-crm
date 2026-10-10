import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAuthInstance, getAuth, auth } from '@/server/auth/better-auth';
import type { DbClient } from '@/server/db/client';

describe('Better-Auth instance configuration and hooks', () => {
  it('creates an auth instance with drizzle adapter and custom options', () => {
    const mockDb = {
      query: {},
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as DbClient;

    const instance = createAuthInstance(mockDb);
    expect(instance).toBeDefined();
    expect(instance.options).toBeDefined();
    expect(instance.options.emailAndPassword.enabled).toBe(true);
    expect(instance.options.session.expiresIn).toBe(30 * 24 * 60 * 60);
  });

  it('tests custom argon2id hash and verify hooks in better-auth options', async () => {
    const mockDb = {} as unknown as DbClient;
    const instance = createAuthInstance(mockDb);
    const passwordHooks = instance.options.emailAndPassword.password;
    expect(passwordHooks).toBeDefined();

    // 1. Valid password hashing and verification
    const validPassword = 'SecurePassword123!';
    const hash = await passwordHooks.hash(validPassword);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');

    const isMatch = await passwordHooks.verify({ password: validPassword, hash });
    expect(isMatch).toBe(true);

    const isWrongMatch = await passwordHooks.verify({ password: 'WrongPassword123!', hash });
    expect(isWrongMatch).toBe(false);

    // 2. Short password rejection
    await expect(passwordHooks.hash('short')).rejects.toThrow();
  });

  it('provides a lazy singleton via getAuth() and auth proxy', () => {
    const instanceA = getAuth();
    const instanceB = getAuth();
    expect(instanceA).toBe(instanceB);
    expect(auth.options).toBeDefined();
  });
});
