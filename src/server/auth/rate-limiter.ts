import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema/auth';

export const ACCOUNT_MAX_ATTEMPTS = 10;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const IP_MAX_ATTEMPTS = 50;
export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Rate limit thresholds for bootstrap setup
export const SETUP_IP_MAX_ATTEMPTS = 10;
export const SETUP_IP_WINDOW_MS = 15 * 60 * 1000;

// Rate limit thresholds for password reset requests (dispatches email)
export const RESET_REQ_ACCOUNT_MAX_ATTEMPTS = 5;
export const RESET_REQ_IP_MAX_ATTEMPTS = 10;
export const RESET_REQ_WINDOW_MS = 15 * 60 * 1000;

// Rate limit thresholds for password reset execution (verifies token)
export const RESET_EXEC_ACCOUNT_MAX_ATTEMPTS = 10;
export const RESET_EXEC_IP_MAX_ATTEMPTS = 15;
export const RESET_EXEC_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: 'account' | 'ip';
}

/**
 * Truncates an IP address adhering to GDPR Art. 5(1)(c) data minimisation:
 * - IPv4: zeroes out host octet (/24 subnet, e.g. 192.168.1.0)
 * - IPv6: zeroes out interface/host bits (/48 subnet, e.g. 2001:db8:85a3::/48)
 */
export function anonymizeIp(ip: string): string {
  const clean = ip.trim();
  if (!clean) return '0.0.0.0';

  // IPv4
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (
      parts.length === 4 &&
      parts[0] !== undefined &&
      parts[1] !== undefined &&
      parts[2] !== undefined
    ) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6
  if (clean.includes(':')) {
    const parts = clean.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::/48`;
  }

  return clean;
}

/**
 * Derives a hashed key for an account identifier to avoid persisting plaintext PII.
 */
export function getAccountKey(identifier: string): string {
  const normalized = identifier.toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `account:${hash}`;
}

/**
 * Derives an anonymised key for an IP address.
 */
export function getIpKey(ip: string): string {
  return `ip:${anonymizeIp(ip)}`;
}

/**
 * Cleans up expired rate-limit records (retention <= 24h).
 */
export async function cleanupExpiredRateLimits(client: DbClient = defaultDb): Promise<number> {
  try {
    const now = new Date();
    await client.delete(rateLimits).where(lt(rateLimits.expiresAt, now));
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Checks whether a key is currently throttled.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const now = new Date();
  try {
    // Prune expired records during check to ensure database retention <= 24h
    void cleanupExpiredRateLimits(client);

    const rows = await client.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (rows.length === 0 || !rows[0]) {
      return {
        allowed: true,
        remaining: maxAttempts,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }

    const record = rows[0];

    // If expired, the window has reset
    if (record.expiresAt.getTime() <= now.getTime()) {
      return {
        allowed: true,
        remaining: maxAttempts,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }

    if (record.count >= maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: record.expiresAt,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - record.count),
      resetAt: record.expiresAt,
    };
  } catch {
    return {
      allowed: true,
      remaining: maxAttempts,
      resetAt: new Date(now.getTime() + windowMs),
    };
  }
}

/**
 * Increments the failure counter for a key.
 */
export async function recordFailedAttempt(
  key: string,
  windowMs: number,
  client: DbClient = defaultDb,
): Promise<void> {
  try {
    const now = new Date();
    const rows = await client.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (rows.length === 0 || !rows[0]) {
      await client.insert(rateLimits).values({
        key,
        count: 1,
        lastAttemptAt: now,
        expiresAt: new Date(now.getTime() + windowMs),
      });
      return;
    }

    const record = rows[0];
    if (record.expiresAt.getTime() <= now.getTime()) {
      // Reset window
      await client
        .update(rateLimits)
        .set({
          count: 1,
          lastAttemptAt: now,
          expiresAt: new Date(now.getTime() + windowMs),
        })
        .where(eq(rateLimits.key, key));
    } else {
      // Increment existing count
      await client
        .update(rateLimits)
        .set({
          count: record.count + 1,
          lastAttemptAt: now,
        })
        .where(eq(rateLimits.key, key));
    }
  } catch {
    // Fail gracefully if DB is offline or not configured
  }
}

/**
 * Resets the rate limit counter for a key (e.g. after successful authentication).
 */
export async function resetRateLimit(key: string, client: DbClient = defaultDb): Promise<void> {
  try {
    await client.delete(rateLimits).where(eq(rateLimits.key, key));
  } catch {
    // Fail gracefully if DB is offline or not configured
  }
}

/**
 * Checks both IP and Account limits before processing a sign-in attempt.
 */
export async function checkSignInRateLimit(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipCheck = await checkRateLimit(getIpKey(ip), IP_MAX_ATTEMPTS, IP_WINDOW_MS, client);
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const accountCheck = await checkRateLimit(
    getAccountKey(identifier),
    ACCOUNT_MAX_ATTEMPTS,
    ACCOUNT_WINDOW_MS,
    client,
  );
  if (!accountCheck.allowed) {
    return { ...accountCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, accountCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), accountCheck.resetAt.getTime())),
  };
}

/**
 * Records a sign-in failure against both the account and the IP.
 */
export async function recordSignInFailure(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await Promise.all([
    recordFailedAttempt(getIpKey(ip), IP_WINDOW_MS, client),
    recordFailedAttempt(getAccountKey(identifier), ACCOUNT_WINDOW_MS, client),
  ]);
}

/**
 * Clears the account rate limit on successful sign-in.
 */
export async function recordSignInSuccess(
  identifier: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await resetRateLimit(getAccountKey(identifier), client);
}

/**
 * Checks rate limits for studio owner bootstrap ceremony.
 */
export async function checkSetupRateLimit(
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const key = `setup:${anonymizeIp(ip)}`;
  return await checkRateLimit(key, SETUP_IP_MAX_ATTEMPTS, SETUP_IP_WINDOW_MS, client);
}

/**
 * Records a failed setup attempt.
 */
export async function recordSetupFailure(ip: string, client: DbClient = defaultDb): Promise<void> {
  const key = `setup:${anonymizeIp(ip)}`;
  await recordFailedAttempt(key, SETUP_IP_WINDOW_MS, client);
}

/**
 * Checks rate limits for password reset requests (dispatching email).
 */
export async function checkPasswordResetRequestRateLimit(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = `reset_req_ip:${anonymizeIp(ip)}`;
  const ipCheck = await checkRateLimit(
    ipKey,
    RESET_REQ_IP_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const acctKey = `reset_req_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  const acctCheck = await checkRateLimit(
    acctKey,
    RESET_REQ_ACCOUNT_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Records a password reset request attempt.
 */
export async function recordPasswordResetRequest(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const ipKey = `reset_req_ip:${anonymizeIp(ip)}`;
  const acctKey = `reset_req_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  await Promise.all([
    recordFailedAttempt(ipKey, RESET_REQ_WINDOW_MS, client),
    recordFailedAttempt(acctKey, RESET_REQ_WINDOW_MS, client),
  ]);
}

/**
 * Checks rate limits for password reset execution (verifying and consuming token).
 */
export async function checkPasswordResetActionRateLimit(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = `reset_exec_ip:${anonymizeIp(ip)}`;
  const ipCheck = await checkRateLimit(
    ipKey,
    RESET_EXEC_IP_MAX_ATTEMPTS,
    RESET_EXEC_WINDOW_MS,
    client,
  );
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const acctKey = `reset_exec_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  const acctCheck = await checkRateLimit(
    acctKey,
    RESET_EXEC_ACCOUNT_MAX_ATTEMPTS,
    RESET_EXEC_WINDOW_MS,
    client,
  );
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Records a failed password reset execution attempt.
 */
export async function recordPasswordResetActionFailure(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const ipKey = `reset_exec_ip:${anonymizeIp(ip)}`;
  const acctKey = `reset_exec_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  await Promise.all([
    recordFailedAttempt(ipKey, RESET_EXEC_WINDOW_MS, client),
    recordFailedAttempt(acctKey, RESET_EXEC_WINDOW_MS, client),
  ]);
}
