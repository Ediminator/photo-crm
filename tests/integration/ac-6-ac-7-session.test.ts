import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  getSessionCookieAttributes,
  createSession,
  rotateSession,
  verifySession,
  signOutEverywhere,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '@/server/auth/session';
import { user } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';

describe('AC-6 & AC-7: Session security attributes, fixation prevention, and global revocation', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-6: session cookie has HttpOnly, SameSite=Lax, and __Secure- prefix in production mode', () => {
    // Development attributes
    const devCookie = getSessionCookieAttributes(false);
    expect(devCookie.httpOnly).toBe(true);
    expect(devCookie.sameSite).toBe('lax');
    expect(devCookie.secure).toBe(false);
    expect(devCookie.name).toBe(SESSION_COOKIE_NAME);

    // Production attributes
    const prodCookie = getSessionCookieAttributes(true);
    expect(prodCookie.httpOnly).toBe(true);
    expect(prodCookie.sameSite).toBe('lax');
    expect(prodCookie.secure).toBe(true);
    expect(prodCookie.name).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(prodCookie.name.startsWith('__Secure-')).toBe(true);
  });

  it('AC-6: session rotation replaces pre-auth session and issues new session ID (session fixation prevention)', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'studio@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    // 1. Pre-auth session exists
    const preAuthSession = await createSession(owner.id, dbClient);
    expect(preAuthSession.token).toBeDefined();

    // 2. On sign-in, rotate session
    const postAuthSession = await rotateSession(preAuthSession.token, owner.id, dbClient);

    // Assert session IDs differ
    expect(postAuthSession.token).not.toBe(preAuthSession.token);
    expect(postAuthSession.id).not.toBe(preAuthSession.id);

    // Assert old pre-auth session is dead
    const oldSessionCheck = await verifySession(preAuthSession.token, dbClient);
    expect(oldSessionCheck).toBeNull();

    // Assert new session is active
    const newSessionCheck = await verifySession(postAuthSession.token, dbClient);
    expect(newSessionCheck).not.toBeNull();
    expect(newSessionCheck?.user.id).toBe(owner.id);
  });

  it('AC-7: "sign out everywhere" invalidates all active sessions for the user immediately', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Multi Device Owner',
        email: 'multi@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    // Create 3 sessions across different devices (desktop, laptop, mobile)
    const session1 = await createSession(owner.id, dbClient, { userAgent: 'Desktop Chrome' });
    const session2 = await createSession(owner.id, dbClient, { userAgent: 'MacBook Safari' });
    const session3 = await createSession(owner.id, dbClient, {
      userAgent: 'iPhone Mobile Safari',
    });

    // Verify all 3 are valid before logout
    expect(await verifySession(session1.token, dbClient)).not.toBeNull();
    expect(await verifySession(session2.token, dbClient)).not.toBeNull();
    expect(await verifySession(session3.token, dbClient)).not.toBeNull();

    // Execute "sign out everywhere"
    await signOutEverywhere(owner.id, dbClient);

    // On next request, all sessions must be invalid
    expect(await verifySession(session1.token, dbClient)).toBeNull();
    expect(await verifySession(session2.token, dbClient)).toBeNull();
    expect(await verifySession(session3.token, dbClient)).toBeNull();
  });
});
