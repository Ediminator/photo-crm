import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { createClientAction, upsertAddressAction } from '@/server/clients/actions';
import { user } from '@/server/db/schema/auth';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import type { DbClient } from '@/server/db/client';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';

describe('AC-2: Input validation and rejection of invalid payloads', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;
    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Create owner user and session
    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Validation Owner',
        email: 'val-owner@example.com',
        role: 'owner',
      })
      .returning();

    if (!owner) throw new Error('Owner missing');

    const sessionRes = await createSession(owner.id, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRes.token);
  });

  afterEach(async () => {
    (globalThis as unknown as { db: DbClient | undefined }).db = undefined;
    await testDb.destroy();
  });

  it('AC-2: rejects empty displayName with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: '',
      primaryContact: {
        givenName: 'Valid',
        familyName: 'User',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields).toContain('displayName');
    expect(JSON.stringify(res)).not.toContain('Valid');

    const clientRows = await dbClient.select().from(clients);
    expect(clientRows.length).toBe(0);
  });

  it('AC-2: rejects 201-character displayName with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'A'.repeat(201),
      primaryContact: {
        givenName: 'Valid',
        familyName: 'User',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields).toContain('displayName');
    expect(JSON.stringify(res)).not.toContain('Valid');

    const clientRows = await dbClient.select().from(clients);
    expect(clientRows.length).toBe(0);
  });

  it('AC-2: rejects both contact names empty with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'Anna Example',
      primaryContact: {
        givenName: '   ',
        familyName: '',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields?.some((f) => f.includes('givenName') || f.includes('familyName'))).toBe(true);
    expect(JSON.stringify(res)).not.toContain('Anna Example');

    const clientRows = await dbClient.select().from(clients);
    expect(clientRows.length).toBe(0);
  });

  it('AC-2: rejects email: "not-an-email" with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'Anna Example',
      primaryContact: {
        givenName: 'Anna',
        email: 'not-an-email',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields?.some((f) => f.includes('email'))).toBe(true);
    expect(JSON.stringify(res)).not.toContain('not-an-email');

    const contactRows = await dbClient.select().from(clientContacts);
    expect(contactRows.length).toBe(0);
  });

  it('AC-2: rejects phone: "call me" with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'Anna Example',
      primaryContact: {
        givenName: 'Anna',
        phone: 'call me',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields?.some((f) => f.includes('phone'))).toBe(true);
    expect(JSON.stringify(res)).not.toContain('call me');

    const contactRows = await dbClient.select().from(clientContacts);
    expect(contactRows.length).toBe(0);
  });

  it('AC-2: rejects country_code: "XX" with VALIDATION_FAILED and writes no row', async () => {
    // First create a valid client
    const validClient = await createClientAction({
      kind: 'person',
      displayName: 'Address Client',
      primaryContact: { givenName: 'John' },
    });

    expect(validClient.success).toBe(true);
    if (!validClient.success) throw new Error('Expected success');
    const clientId = validClient.data.clientId;

    const invalidAddress = {
      clientId,
      type: 'postal' as const,
      line1: 'Bahnhofstraße 1',
      city: 'Berlin',
      postal_code: '10115',
      country_code: 'XX',
    };

    const res = await upsertAddressAction(invalidAddress);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields?.some((f) => f.includes('country_code'))).toBe(true);
    expect(JSON.stringify(res)).not.toContain('Bahnhofstraße');

    const addrRows = await dbClient.select().from(clientAddresses);
    expect(addrRows.length).toBe(0);
  });

  it('AC-2: rejects preferredLocale: "fr" with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'Anna Example',
      preferredLocale: 'fr',
      primaryContact: {
        givenName: 'Anna',
      },
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields).toContain('preferredLocale');
    expect(JSON.stringify(res)).not.toContain('Anna');

    const clientRows = await dbClient.select().from(clients);
    expect(clientRows.length).toBe(0);
  });

  it('AC-2: rejects unknown extra key with VALIDATION_FAILED and writes no row', async () => {
    const invalidInput = {
      kind: 'person' as const,
      displayName: 'Anna Example',
      primaryContact: {
        givenName: 'Anna',
      },
      maliciousField: 'exploit_payload',
    };

    const res = await createClientAction(invalidInput);

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.fields).toContain('maliciousField');
    expect(JSON.stringify(res)).not.toContain('exploit_payload');

    const clientRows = await dbClient.select().from(clients);
    expect(clientRows.length).toBe(0);
  });
});
