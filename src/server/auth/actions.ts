'use server';

import 'server-only';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, type DbClient } from '@/server/db/client';
import { user, account } from '@/server/db/schema/auth';
import { verifyPasswordArgon2id } from './passwords/policy';
import { checkSignInRateLimit, recordSignInFailure, recordSignInSuccess } from './rate-limiter';
import {
  rotateSession,
  revokeSession,
  signOutEverywhere,
  getSessionCookieAttributes,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from './session';
import { setupOwner } from './setup';
import { requestPasswordReset, resetPassword } from './password-reset';
import { requireOwner } from './guards';
import { env } from '@/env';

export type ActionResult<T = unknown> =
  { success: true; data?: T; error?: never } | { success: false; error: string; data?: never };

/**
 * Helper to determine client IP address from Next.js request headers.
 */
async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) {
      const firstIp = forwarded.split(',')[0];
      if (firstIp) return firstIp.trim();
    }
    return h.get('x-real-ip') ?? '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

/**
 * Helper to set session cookie on the response.
 */
async function setSessionCookie(token: string): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const attrs = getSessionCookieAttributes(isProd);
  const cookieStore = await cookies();
  cookieStore.set(attrs.name, token, {
    httpOnly: attrs.httpOnly,
    sameSite: attrs.sameSite,
    secure: attrs.secure,
    path: attrs.path,
    maxAge: attrs.maxAge,
  });
}

/**
 * Helper to remove session cookie on the response.
 */
async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(SECURE_SESSION_COOKIE_NAME);
}

/**
 * Setup Owner Action (Public allowlisted; guarded by setup token & count=0).
 */
export async function setupOwnerAction(
  formData: {
    setupToken: string;
    name: string;
    email: string;
    password: string;
  },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  try {
    const owner = await setupOwner({ ...formData, client });
    const session = await rotateSession(null, owner.id, client);
    await setSessionCookie(session.token);

    return {
      success: true,
      data: {
        user: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
        },
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Setup failed.',
    };
  }
}

/**
 * Sign In Action (Public allowlisted; guarded by database-backed rate limiting).
 */
export async function signInAction(
  formData: {
    email: string;
    password: string;
  },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  const normalizedEmail = formData.email.toLowerCase().trim();
  const ip = await getClientIp();

  // 1. Rate limiting check (survives restarts)
  const rateLimitStatus = await checkSignInRateLimit(normalizedEmail, ip, client);
  if (!rateLimitStatus.allowed) {
    return {
      success: false,
      error: 'Too many failed attempts. Please try again later.',
    };
  }

  // 2. Query user by email
  const userRows = await client.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

  if (userRows.length === 0) {
    await recordSignInFailure(normalizedEmail, ip, client);
    // Generic error to prevent enumeration
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  const existingUser = userRows[0];
  if (!existingUser) {
    await recordSignInFailure(normalizedEmail, ip, client);
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  // 3. Query password hash from account
  const accountRows = await client
    .select()
    .from(account)
    .where(eq(account.userId, existingUser.id))
    .limit(1);

  const acc = accountRows[0];
  if (!acc?.password) {
    await recordSignInFailure(normalizedEmail, ip, client);
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  // 4. Verify password with Argon2id
  const passwordMatch = await verifyPasswordArgon2id(acc.password, formData.password);

  if (!passwordMatch) {
    await recordSignInFailure(normalizedEmail, ip, client);
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  // 5. Successful authentication
  await recordSignInSuccess(normalizedEmail, client);

  // Retrieve any pre-existing cookie to rotate session
  let oldToken: string | undefined;
  try {
    const cookieStore = await cookies();
    oldToken =
      cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
      cookieStore.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    oldToken = undefined;
  }

  const newSession = await rotateSession(oldToken, existingUser.id, client, {
    ipAddress: ip,
  });
  await setSessionCookie(newSession.token);

  return {
    success: true,
    data: {
      user: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      },
    },
  };
}

/**
 * Sign Out Action (Public allowlisted).
 */
export async function signOutAction(client: DbClient = db): Promise<ActionResult> {
  try {
    const cookieStore = await cookies();
    const token =
      cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
      cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      await revokeSession(token, client);
    }
    await clearSessionCookie();
    return { success: true };
  } catch {
    await clearSessionCookie();
    return { success: true };
  }
}

/**
 * Sign Out Everywhere Action (Protected; requires owner session).
 */
export async function signOutEverywhereAction(client: DbClient = db): Promise<ActionResult> {
  const context = await requireOwner({ client });
  await signOutEverywhere(context.user.id, client);
  await clearSessionCookie();
  return { success: true };
}

/**
 * Request Password Reset Action (Public allowlisted).
 */
export async function requestPasswordResetAction(
  formData: {
    email: string;
  },
  options: {
    client?: DbClient;
    baseUrl?: string;
    transporter?: import('nodemailer').Transporter;
  } = {},
): Promise<ActionResult<{ message: string }>> {
  try {
    let baseUrl = 'http://localhost:3000';
    try {
      baseUrl = env.AUTH_URL;
    } catch {
      baseUrl = process.env.AUTH_URL ?? baseUrl;
    }
    const result = await requestPasswordReset(formData.email, {
      baseUrl: options.baseUrl ?? baseUrl,
      client: options.client ?? db,
      transporter: options.transporter,
    });
    return {
      success: true,
      data: { message: result.message },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Password reset request failed.',
    };
  }
}

/**
 * Reset Password Action (Public allowlisted; guarded by single-use token).
 */
export async function resetPasswordAction(
  formData: {
    email: string;
    token: string;
    newPassword: string;
  },
  client: DbClient = db,
): Promise<ActionResult> {
  try {
    await resetPassword({ ...formData, client });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Password reset failed.',
    };
  }
}

/**
 * Protected action example verifying that guarded server actions enforce requireOwner().
 */
export async function getOwnerSessionInfoAction(
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; role: string } }>> {
  const context = await requireOwner({ client });
  return {
    success: true,
    data: {
      user: {
        id: context.user.id,
        email: context.user.email,
        role: context.user.role,
      },
    },
  };
}
