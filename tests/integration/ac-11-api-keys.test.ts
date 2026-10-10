import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { createApiKey, revokeApiKey, verifyApiKey, API_KEY_PREFIX } from '@/server/auth/api-keys';
import { requireAuth, UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import { user } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';

describe('AC-11: API key authentication, scope enforcement, and revocation', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-11: creates API key with format pcrm_live_<hex> and authenticates matching scopes (200 OK equivalent)', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'API Studio Owner',
        email: 'api-owner@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Owner missing');

    // Create an API key with clients:read scope
    const { apiKey, record } = await createApiKey({
      userId: owner.id,
      name: 'Agent Read Access',
      scopes: ['clients:read'],
      client: dbClient,
    });

    // Check token format
    expect(apiKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(apiKey.length).toBe(API_KEY_PREFIX.length + 64);
    expect(record.prefix).toBe(apiKey.slice(0, 16));

    // Authorize with matching scope -> SUCCESS
    const authContext = await requireAuth({
      scopes: ['clients:read'],
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      client: dbClient,
    });

    expect(authContext.authType).toBe('apiKey');
    expect(authContext.user.id).toBe(owner.id);
    expect(authContext.scopes).toEqual(['clients:read']);

    // Check last_used_at was updated in DB
    const verification = await verifyApiKey(apiKey, dbClient);
    expect(verification.valid).toBe(true);
    expect(verification.key?.lastUsedAt).not.toBeNull();
  });

  it('AC-11: rejects request with 403 Forbidden when key lacks required write scope', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'API Studio Owner',
        email: 'api-owner-2@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    // Create API key with only read scope
    const { apiKey } = await createApiKey({
      userId: owner.id,
      name: 'Read Only Key',
      scopes: ['clients:read'],
      client: dbClient,
    });

    // Request requires clients:write -> Must reject with 403 Forbidden
    await expect(
      requireAuth({
        scopes: ['clients:write'],
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        client: dbClient,
      }),
    ).rejects.toThrow(ForbiddenError);

    // Multi-scope request where one is missing -> Must reject with 403 Forbidden
    await expect(
      requireAuth({
        scopes: ['clients:read', 'clients:write'],
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        client: dbClient,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('AC-11: rejects revoked key with 401 Unauthorized', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'API Studio Owner',
        email: 'api-owner-3@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    const { apiKey, record } = await createApiKey({
      userId: owner.id,
      name: 'Key To Revoke',
      scopes: ['clients:read'],
      client: dbClient,
    });

    // Revoke the key
    await revokeApiKey(record.id, dbClient);

    // Authorization must now fail with 401 Unauthorized
    await expect(
      requireAuth({
        scopes: ['clients:read'],
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        client: dbClient,
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('AC-11: rejects expired key with 401 Unauthorized', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'API Studio Owner',
        email: 'api-owner-4@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    // Create a key with -1 days (already expired in the past)
    const { apiKey } = await createApiKey({
      userId: owner.id,
      name: 'Expired Key',
      scopes: ['clients:read'],
      expiresInDays: -1, // Expired yesterday
      client: dbClient,
    });

    await expect(
      requireAuth({
        scopes: ['clients:read'],
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        client: dbClient,
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('AC-11: verifyApiKey handles invalid formats and unknown keys', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Invalid formats
    const res1 = await verifyApiKey('', dbClient);
    expect(res1.valid).toBe(false);
    expect(res1.error).toBe('invalid_format');

    const res2 = await verifyApiKey(null as unknown as string, dbClient);
    expect(res2.valid).toBe(false);
    expect(res2.error).toBe('invalid_format');

    // 2. Unknown key
    const res3 = await verifyApiKey(
      'pcrm_live_0000000000000000000000000000000000000000000000000000000000000000',
      dbClient,
    );
    expect(res3.valid).toBe(false);
    expect(res3.error).toBe('not_found');
  });

  it('I1-S02: requireOwner rejects API key with limited scopes (e.g. clients:read) with 403 Forbidden', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Scoped Owner',
        email: 'scoped-owner@example.com',
        role: 'owner',
      })
      .returning();

    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to be defined');

    // Key with only read scope
    const { apiKey: readKey } = await createApiKey({
      userId: owner.id,
      name: 'Read Key',
      scopes: ['clients:read'],
      client: dbClient,
    });

    const { requireOwner } = await import('@/server/auth/guards');

    // Limited scope key MUST be rejected by requireOwner with 403 Forbidden
    await expect(
      requireOwner({
        headers: {
          authorization: `Bearer ${readKey}`,
        },
        client: dbClient,
      }),
    ).rejects.toThrow('API key lacks administrative scope required for this action.');

    // Key with admin/wildcard scope MUST be allowed
    const { apiKey: adminKey } = await createApiKey({
      userId: owner.id,
      name: 'Admin Key',
      scopes: ['*'],
      client: dbClient,
    });

    const adminContext = await requireOwner({
      headers: {
        authorization: `Bearer ${adminKey}`,
      },
      client: dbClient,
    });
    expect(adminContext.user.id).toBe(owner.id);
  });
});
