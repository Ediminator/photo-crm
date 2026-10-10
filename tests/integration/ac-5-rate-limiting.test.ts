import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  checkSignInRateLimit,
  recordSignInFailure,
  recordSignInSuccess,
  ACCOUNT_MAX_ATTEMPTS,
  checkSetupRateLimit,
  recordSetupFailure,
  SETUP_IP_MAX_ATTEMPTS,
  checkPasswordResetRequestRateLimit,
  recordPasswordResetRequest,
  RESET_REQ_ACCOUNT_MAX_ATTEMPTS,
  RESET_REQ_IP_MAX_ATTEMPTS,
  checkPasswordResetActionRateLimit,
  recordPasswordResetActionFailure,
  RESET_EXEC_ACCOUNT_MAX_ATTEMPTS,
  RESET_EXEC_IP_MAX_ATTEMPTS,
  cleanupExpiredRateLimits,
  anonymizeIp,
} from '@/server/auth/rate-limiter';
import { rateLimits } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';

describe('AC-5: Database-backed rate limiting surviving restarts', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-5: throttles account after 10 failed sign-ins across rotating IPs', async () => {
    const account = 'photographer@example.com';
    const dbClient = testDb.db as unknown as DbClient;

    // Record 9 failures from 9 different IPs
    for (let i = 1; i <= 9; i++) {
      const ip = `192.168.1.${String(i)}`;
      const statusBefore = await checkSignInRateLimit(account, ip, dbClient);
      expect(statusBefore.allowed).toBe(true);

      await recordSignInFailure(account, ip, dbClient);
    }

    // 10th attempt: still permitted before the failure is recorded
    const tenthIp = '192.168.1.10';
    const tenthCheck = await checkSignInRateLimit(account, tenthIp, dbClient);
    expect(tenthCheck.allowed).toBe(true);
    expect(tenthCheck.remaining).toBe(1);

    await recordSignInFailure(account, tenthIp, dbClient);

    // 11th attempt from a brand new IP must be throttled due to account limit
    const eleventhIp = '192.168.1.11';
    const eleventhCheck = await checkSignInRateLimit(account, eleventhIp, dbClient);
    expect(eleventhCheck.allowed).toBe(false);
    expect(eleventhCheck.reason).toBe('account');
    expect(eleventhCheck.remaining).toBe(0);

    // Successful sign-in clears account throttle
    await recordSignInSuccess(account, dbClient);
    const postResetCheck = await checkSignInRateLimit(account, eleventhIp, dbClient);
    expect(postResetCheck.allowed).toBe(true);
  });

  it('AC-5: throttles IP after 50 failures across different accounts', async () => {
    const attackingIp = '203.0.113.42';
    const dbClient = testDb.db as unknown as DbClient;

    // Record 49 failures across 49 unique accounts
    for (let i = 1; i <= 49; i++) {
      const account = `victim-${String(i)}@example.com`;
      await recordSignInFailure(account, attackingIp, dbClient);
    }

    // 50th attempt check
    const check50 = await checkSignInRateLimit('victim-50@example.com', attackingIp, dbClient);
    expect(check50.allowed).toBe(true);
    expect(check50.remaining).toBe(1);

    await recordSignInFailure('victim-50@example.com', attackingIp, dbClient);

    // 51st attempt from that IP to a totally fresh account must be throttled
    const check51 = await checkSignInRateLimit('brand-new@example.com', attackingIp, dbClient);
    expect(check51.allowed).toBe(false);
    expect(check51.reason).toBe('ip');
    expect(check51.remaining).toBe(0);
  });

  it('AC-5: rate limit persists across server/connection restarts (DB-backed)', async () => {
    const targetAccount = 'owner@example.org';
    const testIp = '198.51.100.99';
    const dbClient1 = testDb.db as unknown as DbClient;

    // Exhaust attempts on initial database connection
    for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS; i++) {
      await recordSignInFailure(targetAccount, `10.0.0.${String(i)}`, dbClient1);
    }

    // Verify throttled on initial client
    const check1 = await checkSignInRateLimit(targetAccount, testIp, dbClient1);
    expect(check1.allowed).toBe(false);

    // Simulate server restart: create a new Drizzle client wrapping the same underlying PGlite instance
    // (simulating a restarted application container connecting to the persistent PostgreSQL engine)
    const { drizzle } = await import('drizzle-orm/pglite');
    const restartedDbClient = drizzle(testDb.client) as unknown as DbClient;

    // Verify rate limit state survived the restart
    const checkAfterRestart = await checkSignInRateLimit(targetAccount, testIp, restartedDbClient);
    expect(checkAfterRestart.allowed).toBe(false);
    expect(checkAfterRestart.reason).toBe('account');
  });

  it('AC-5 / I1-S04: throttles studio setup bootstrap after SETUP_IP_MAX_ATTEMPTS (10 attempts)', async () => {
    const testIp = '198.51.100.25';
    const dbClient = testDb.db as unknown as DbClient;

    const initial = await checkSetupRateLimit(testIp, dbClient);
    expect(initial.allowed).toBe(true);
    expect(initial.remaining).toBe(SETUP_IP_MAX_ATTEMPTS);

    // Record 10 failed attempts
    for (let i = 0; i < SETUP_IP_MAX_ATTEMPTS; i++) {
      await recordSetupFailure(testIp, dbClient);
    }

    const throttled = await checkSetupRateLimit(testIp, dbClient);
    expect(throttled.allowed).toBe(false);
    expect(throttled.remaining).toBe(0);

    // Different IP in another subnet should still be allowed
    const freshIp = '203.0.113.10';
    const freshCheck = await checkSetupRateLimit(freshIp, dbClient);
    expect(freshCheck.allowed).toBe(true);
  });

  it('AC-5 / I1-S04: throttles password reset requests per account and per IP', async () => {
    const targetEmail = 'victim-reset@example.com';
    const dbClient = testDb.db as unknown as DbClient;

    // Record requests up to limit from rotating subnets
    for (let i = 1; i <= RESET_REQ_ACCOUNT_MAX_ATTEMPTS; i++) {
      const ip = `10.${String(i)}.0.1`;
      await recordPasswordResetRequest(targetEmail, ip, dbClient);
    }

    // Next request for target email must be throttled due to account limit
    const acctCheck = await checkPasswordResetRequestRateLimit(targetEmail, '172.16.0.1', dbClient);
    expect(acctCheck.allowed).toBe(false);
    expect(acctCheck.reason).toBe('account');

    // Test IP throttle across different accounts
    const attackerIp = '198.51.100.88';
    for (let i = 1; i <= RESET_REQ_IP_MAX_ATTEMPTS; i++) {
      await recordPasswordResetRequest(`acct-${String(i)}@example.com`, attackerIp, dbClient);
    }

    const ipCheck = await checkPasswordResetRequestRateLimit(
      'new-target@example.com',
      attackerIp,
      dbClient,
    );
    expect(ipCheck.allowed).toBe(false);
    expect(ipCheck.reason).toBe('ip');
  });

  it('AC-5 / I1-S04: throttles password reset execution per account and per IP', async () => {
    const targetEmail = 'victim-exec@example.com';
    const dbClient = testDb.db as unknown as DbClient;

    for (let i = 1; i <= RESET_EXEC_ACCOUNT_MAX_ATTEMPTS; i++) {
      const ip = `10.${String(i)}.0.1`;
      await recordPasswordResetActionFailure(targetEmail, ip, dbClient);
    }

    const acctCheck = await checkPasswordResetActionRateLimit(targetEmail, '172.16.0.1', dbClient);
    expect(acctCheck.allowed).toBe(false);
    expect(acctCheck.reason).toBe('account');

    const attackerIp = '198.51.100.99';
    for (let i = 1; i <= RESET_EXEC_IP_MAX_ATTEMPTS; i++) {
      await recordPasswordResetActionFailure(`exec-${String(i)}@example.com`, attackerIp, dbClient);
    }

    const ipCheck = await checkPasswordResetActionRateLimit(
      'brand-new-exec@example.com',
      attackerIp,
      dbClient,
    );
    expect(ipCheck.allowed).toBe(false);
    expect(ipCheck.reason).toBe('ip');
  });

  it('AC-5 / I1-S05: stores anonymised /24 IPv4, /48 IPv6, and hashed account identifiers without raw PII', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const rawEmail = 'photographer.personal@example.com';
    const rawIpv4 = '198.51.100.42';
    const rawIpv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

    // Unit checks for anonymizeIp
    expect(anonymizeIp(rawIpv4)).toBe('198.51.100.0');
    expect(anonymizeIp('  10.20.30.40  ')).toBe('10.20.30.0');
    expect(anonymizeIp(rawIpv6)).toContain('::/48');

    // Record sign-in failure with raw values
    await recordSignInFailure(rawEmail, rawIpv4, dbClient);

    // Query database directly to inspect stored keys
    const rows = await dbClient.select().from(rateLimits);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows) {
      // Must not contain raw email or @ symbol
      expect(row.key).not.toContain(rawEmail);
      expect(row.key).not.toContain('@example.com');
      // Must not contain host octet (.42) of the IP
      expect(row.key).not.toContain('198.51.100.42');
    }

    // Account key must be hashed with sha256 prefix
    const accountRow = rows.find((r) => r.key.startsWith('account:'));
    expect(accountRow).toBeDefined();
    expect(accountRow?.key).toMatch(/^account:[a-f0-9]{32}$/);

    // IP key must end in .0
    const ipRow = rows.find((r) => r.key.startsWith('ip:'));
    expect(ipRow).toBeDefined();
    expect(ipRow?.key).toBe('ip:198.51.100.0');
  });

  it('AC-5 / I1-S05: cleanupExpiredRateLimits purges expired records while retaining active windows', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const now = Date.now();

    // Insert expired record (expired 1 hour ago)
    await dbClient.insert(rateLimits).values({
      key: 'ip:expired.0.0.0',
      count: 5,
      lastAttemptAt: new Date(now - 7200000),
      expiresAt: new Date(now - 3600000),
    });

    // Insert active record (expires in 15 minutes)
    await dbClient.insert(rateLimits).values({
      key: 'ip:active.0.0.0',
      count: 2,
      lastAttemptAt: new Date(now),
      expiresAt: new Date(now + 900000),
    });

    // Run cleanup
    const cleaned = await cleanupExpiredRateLimits(dbClient);
    expect(cleaned).toBe(1);

    const remainingRows = await dbClient.select().from(rateLimits);
    const expiredRow = remainingRows.find((r) => r.key === 'ip:expired.0.0.0');
    const activeRow = remainingRows.find((r) => r.key === 'ip:active.0.0.0');

    expect(expiredRow).toBeUndefined();
    expect(activeRow).toBeDefined();
  });
});
