import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import * as authSchema from '@/server/db/schema/auth';
import { env } from '@/env';
import {
  hashPasswordArgon2id,
  verifyPasswordArgon2id,
  validatePasswordPolicy,
} from './passwords/policy';
import { generateUuidV7 } from '@/lib/id';

export const DEFAULT_PLACEHOLDER_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Factory function creating a Better-Auth instance.
 * Allows passing an isolated test database client for integration testing.
 */
export function createAuthInstance(client: DbClient = defaultDb) {
  let secret = DEFAULT_PLACEHOLDER_SECRET;
  let baseURL = 'http://localhost:3000';
  let isProd = false;

  try {
    secret = env.AUTH_SECRET;
    baseURL = env.AUTH_URL;
    isProd = env.NODE_ENV === 'production';
  } catch {
    secret = process.env.AUTH_SECRET ?? secret;
    baseURL = process.env.AUTH_URL ?? baseURL;
    isProd = process.env.NODE_ENV === 'production';
  }

  if (isProd && (!secret || secret === DEFAULT_PLACEHOLDER_SECRET || secret.length < 32)) {
    throw new Error('AUTH_SECRET is required and must be at least 32 characters in production.');
  }

  return betterAuth({
    database: drizzleAdapter(client, {
      provider: 'pg',
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
      },
    }),
    secret,
    baseURL,
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'owner',
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 1024,
      password: {
        hash: async (password: string) => {
          const validation = validatePasswordPolicy(password);
          if (!validation.valid) {
            throw new Error(validation.message ?? 'Invalid password');
          }
          return await hashPasswordArgon2id(password);
        },
        verify: async ({ password, hash }: { password: string; hash: string }) => {
          return await verifyPasswordArgon2id(hash, password);
        },
      },
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days absolute timeout
      updateAge: 7 * 24 * 60 * 60, // 7 days idle timeout
      cookieCache: {
        enabled: false,
      },
    },
    advanced: {
      generateId: () => generateUuidV7(),
      useSecureCookies: isProd,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
      },
    },
  });
}

// Lazy getter for the singleton auth instance to avoid premature env validation at build time
let cachedAuth: ReturnType<typeof createAuthInstance> | null = null;

export function getAuth(): ReturnType<typeof createAuthInstance> {
  cachedAuth ??= createAuthInstance();
  return cachedAuth;
}

export const auth = new Proxy({} as ReturnType<typeof createAuthInstance>, {
  get(_target, prop) {
    const instance = getAuth();
    return Reflect.get(instance, prop) as unknown;
  },
});
