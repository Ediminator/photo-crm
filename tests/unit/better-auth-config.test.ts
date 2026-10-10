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

  it('I1-S01: disables unauthenticated public email sign-up', () => {
    const mockDb = {} as unknown as DbClient;
    const instance = createAuthInstance(mockDb);
    expect(instance.options.emailAndPassword.disableSignUp).toBe(true);
  });

  it('I1-S06: fails fast in production if AUTH_SECRET is missing or matches placeholder', () => {
    const mockDb = {} as unknown as DbClient;
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.AUTH_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.AUTH_SECRET;

      expect(() => createAuthInstance(mockDb)).toThrow(
        'AUTH_SECRET is required and must be at least 32 characters in production.',
      );

      process.env.AUTH_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(() => createAuthInstance(mockDb)).toThrow(
        'AUTH_SECRET is required and must be at least 32 characters in production.',
      );

      process.env.AUTH_SECRET = 'too-short';
      expect(() => createAuthInstance(mockDb)).toThrow(
        'AUTH_SECRET is required and must be at least 32 characters in production.',
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.AUTH_SECRET = originalSecret;
      } else {
        delete process.env.AUTH_SECRET;
      }
    }
  });
});
