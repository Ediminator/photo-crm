import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  checkSignInRateLimit,
  recordSignInFailure,
  recordSignInSuccess,
  ACCOUNT_MAX_ATTEMPTS,
} from '@/server/auth/rate-limiter';
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
});
