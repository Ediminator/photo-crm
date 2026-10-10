import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema/auth';

export const ACCOUNT_MAX_ATTEMPTS = 10;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const IP_MAX_ATTEMPTS = 50;
export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: 'account' | 'ip';
}

export function getAccountKey(identifier: string): string {
  return `account:${identifier.toLowerCase().trim()}`;
}

export function getIpKey(ip: string): string {
  return `ip:${ip.trim()}`;
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
  const rows = await client.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

  if (rows.length === 0) {
    return {
      allowed: true,
      remaining: maxAttempts,
      resetAt: new Date(now.getTime() + windowMs),
    };
  }

  const record = rows[0];
  if (!record) {
    return {
      allowed: true,
      remaining: maxAttempts,
      resetAt: new Date(now.getTime() + windowMs),
    };
  }

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
}

/**
 * Increments the failure counter for a key.
 */
export async function recordFailedAttempt(
  key: string,
  windowMs: number,
  client: DbClient = defaultDb,
): Promise<void> {
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
}

/**
 * Resets the rate limit counter for a key (e.g. after successful authentication).
 */
export async function resetRateLimit(key: string, client: DbClient = defaultDb): Promise<void> {
  await client.delete(rateLimits).where(eq(rateLimits.key, key));
}

/**
 * Checks both IP and Account limits before processing a sign-in attempt.
 */
export async function checkSignInRateLimit(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  // Check IP limit first
  const ipCheck = await checkRateLimit(getIpKey(ip), IP_MAX_ATTEMPTS, IP_WINDOW_MS, client);
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  // Check Account limit
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
