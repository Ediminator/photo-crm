'use server';

import 'server-only';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, type DbClient } from '@/server/db/client';
import { user, account } from '@/server/db/schema/auth';
import { verifyPasswordArgon2id, validatePasswordPolicy } from './passwords/policy';
import {
  checkSignInRateLimit,
  recordSignInFailure,
  recordSignInSuccess,
  anonymizeIp,
  checkSetupRateLimit,
  recordSetupFailure,
  checkPasswordResetRequestRateLimit,
  recordPasswordResetRequest,
  checkPasswordResetActionRateLimit,
  recordPasswordResetActionFailure,
} from './rate-limiter';
import {
  rotateSession,
  revokeSession,
  verifySession,
  signOutEverywhere,
  getSessionCookieAttributes,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from './session';
import { setupOwner } from './setup';
import { requestPasswordReset, resetPassword } from './password-reset';
import { requireOwner } from './guards';
import { env } from '@/env';
import { audit } from '@/server/audit';

export type ActionResult<T = unknown> =
  { success: true; data?: T; error?: never } | { success: false; error: string; data?: never };

/**
 * Helper to determine client IP address from Next.js request headers.
 */
async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const realIp = h.get('x-real-ip');
    if (realIp) return realIp.trim();

    const forwarded = h.get('x-forwarded-for');
    if (forwarded) {
      const firstIp = forwarded.split(',')[0];
      if (firstIp) return firstIp.trim();
    }
    return '127.0.0.1';
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
  const ip = await getClientIp();

  try {
    // Rate limiting on setup (I1-S04)
    const rateLimitStatus = await checkSetupRateLimit(ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many setup attempts. Please try again later.',
      };
    }

    const owner = await setupOwner({ ...formData, client });
    const session = await rotateSession(null, owner.id, client, {
      ipAddress: anonymizeIp(ip), // I1-S05
    });
    await setSessionCookie(session.token);

    try {
      await audit(
        {
          actorType: 'system',
          actorId: owner.id,
          action: 'auth.setup.completed',
          targetType: 'user',
          targetId: owner.id,
          outcome: 'success',
          metadata: {
            owner_id: owner.id,
            setup_method: 'initial_bootstrap',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal if audit logging encounters a transient error
    }

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
    try {
      await recordSetupFailure(ip, client);
    } catch {
      // Ignore database connection errors during failure recording
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Setup failed.',
    };
  }
}

async function recordSignInAuditFailure(ip: string, client: DbClient): Promise<void> {
  try {
    await audit(
      {
        actorType: 'system',
        actorId: null,
        action: 'auth.sign_in.failure',
        targetType: 'user',
        outcome: 'failure',
        metadata: {
          failure_reason: 'invalid_credentials',
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
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
    await recordSignInAuditFailure(ip, client);
    // Generic error to prevent enumeration
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  const existingUser = userRows[0];
  if (!existingUser) {
    await recordSignInFailure(normalizedEmail, ip, client);
    await recordSignInAuditFailure(ip, client);
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
    await recordSignInAuditFailure(ip, client);
    return {
      success: false,
      error: 'Invalid email or password.',
    };
  }

  // 4. Verify password with Argon2id
  const passwordMatch = await verifyPasswordArgon2id(acc.password, formData.password);

  if (!passwordMatch) {
    await recordSignInFailure(normalizedEmail, ip, client);
    await recordSignInAuditFailure(ip, client);
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
    ipAddress: anonymizeIp(ip),
  });
  await setSessionCookie(newSession.token);

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: existingUser.id,
        action: 'auth.sign_in.success',
        targetType: 'session',
        targetId: newSession.id,
        outcome: 'success',
        metadata: {
          session_id: newSession.id,
          auth_method: 'password',
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal if audit logging encounters a transient error
  }

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

    let sessionId: string | null = null;
    let actorId: string | null = null;

    if (token) {
      const verified = await verifySession(token, client);
      if (verified) {
        sessionId = verified.session.id;
        actorId = verified.user.id;
      }
      await revokeSession(token, client);
    }
    await clearSessionCookie();

    try {
      await audit(
        {
          actorType: 'owner',
          actorId,
          action: 'auth.sign_out.success',
          targetType: 'session',
          targetId: sessionId,
          outcome: 'success',
          metadata: {
            session_id: sessionId,
            everywhere: false,
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

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

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.sign_out.success',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          everywhere: true,
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }

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
  // 1. Fast format validation
  const email = formData.email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return {
      success: false,
      error: 'Invalid email address.',
    };
  }

  try {
    const client = options.client ?? db;
    const ip = await getClientIp();

    // 2. Rate limiting for password reset requests (I1-S04)
    const rateLimitStatus = await checkPasswordResetRequestRateLimit(email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many password reset requests. Please try again later.',
      };
    }
    await recordPasswordResetRequest(email, ip, client);

    let baseUrl = 'http://localhost:3000';
    try {
      baseUrl = env.AUTH_URL;
    } catch {
      baseUrl = process.env.AUTH_URL ?? baseUrl;
    }
    const result = await requestPasswordReset(email, {
      baseUrl: options.baseUrl ?? baseUrl,
      client,
      transporter: options.transporter,
    });

    try {
      await audit(
        {
          actorType: 'system',
          actorId: null,
          action: 'auth.password_reset.requested',
          outcome: 'success',
          metadata: {
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

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
  // 1. Validate password policy first before DB access
  const policy = validatePasswordPolicy(formData.newPassword);
  if (!policy.valid) {
    return {
      success: false,
      error: policy.message ?? 'Invalid password',
    };
  }

  try {
    const ip = await getClientIp();

    // 2. Rate limiting for reset action (I1-S04)
    const rateLimitStatus = await checkPasswordResetActionRateLimit(formData.email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many password reset attempts. Please try again later.',
      };
    }

    await resetPassword({ ...formData, client });

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: null,
          action: 'auth.password_reset.completed',
          outcome: 'success',
          metadata: {
            duration_ms: 0,
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return { success: true };
  } catch (err) {
    try {
      const ip = await getClientIp();
      await recordPasswordResetActionFailure(formData.email, ip, client);
    } catch {
      // Ignore database connection errors during failure recording
    }
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
