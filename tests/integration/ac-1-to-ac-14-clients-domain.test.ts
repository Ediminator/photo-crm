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
import {
  createClientAction,
  updateClientAction,
  addContactAction,
  updateContactAction,
  removeContactAction,
  upsertAddressAction,
  removeAddressAction,
  getClientAction,
  listClientsAction,
} from '@/server/clients/actions';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { auditEvents } from '@/server/db/schema/audit';
import type { DbClient } from '@/server/db/client';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/server/log';

describe('AC-1 to AC-14: Clients and contacts domain core', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;
    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Studio settings with default_locale = 'de' (for AC-1)
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Test',
      default_locale: 'de',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
    });

    // 2. Owner user and web session
    const [insertedOwner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();

    if (!insertedOwner) throw new Error('Owner setup failed');
    ownerUser = insertedOwner;

    const sessionRes = await createSession(ownerUser.id, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRes.token);
  });

  afterEach(async () => {
    (globalThis as unknown as { db: DbClient | undefined }).db = undefined;
    await testDb.destroy();
  });

  it('AC-1: creates client with primary contact, preferred_locale=de default, and audit event', async () => {
    const res = await createClientAction({
      kind: 'person',
      displayName: 'Anna Example',
      primaryContact: {
        givenName: 'Anna',
        familyName: 'Example',
        email: 'anna@example.com',
        phone: '+49 30 0000 0001',
      },
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected success');
    const clientId = res.data.clientId;

    // Client persisted with preferred_locale = 'de'
    const [clientRow] = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRow).toBeDefined();
    expect(clientRow?.displayName).toBe('Anna Example');
    expect(clientRow?.preferredLocale).toBe('de');
    expect(clientRow?.kind).toBe('person');

    // Primary contact persisted with is_primary = true
    const contactRows = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId));
    expect(contactRows.length).toBe(1);
    expect(contactRows[0]?.isPrimary).toBe(true);
    expect(contactRows[0]?.emailNormalized).toBe('anna@example.com');

    // Audit event client.created
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'client.created'), eq(auditEvents.targetId, clientId)));

    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.actorId).toBe(ownerUser.id);
    expect(auditRows[0]?.actorType).toBe('owner');
    expect(auditRows[0]?.outcome).toBe('success');
  });

  it('AC-3: detects duplicate email across clients and respects acknowledgeDuplicates flag', async () => {
    // Create initial client with Anna.Example@Example.com
    const initialRes = await createClientAction({
      kind: 'person',
      displayName: 'Initial Client',
      primaryContact: {
        givenName: 'Anna',
        familyName: 'Example',
        email: 'Anna.Example@Example.com',
      },
    });
    expect(initialRes.success).toBe(true);
    if (!initialRes.success) throw new Error('Expected success');
    const initialClientId = initialRes.data.clientId;

    // Attempt second client with email ' anna.example@example.COM ' without acknowledge
    const duplicateRes = await createClientAction({
      kind: 'person',
      displayName: 'Second Client',
      primaryContact: {
        givenName: 'Another Anna',
        email: ' anna.example@example.COM ',
      },
    });

    expect(duplicateRes.success).toBe(false);
    expect(duplicateRes.code).toBe('DUPLICATE_EMAIL');
    if (duplicateRes.success) throw new Error('Expected failure');
    expect(duplicateRes.duplicates).toEqual([
      { clientId: initialClientId, displayName: 'Initial Client' },
    ]);

    // Ensure second client was not written
    const secondSearch = await dbClient
      .select()
      .from(clients)
      .where(eq(clients.displayName, 'Second Client'));
    expect(secondSearch.length).toBe(0);

    // Repeat with acknowledgeDuplicates: true
    const acknowledgedRes = await createClientAction({
      kind: 'person',
      displayName: 'Second Client',
      primaryContact: {
        givenName: 'Another Anna',
        email: ' anna.example@example.COM ',
      },
      acknowledgeDuplicates: true,
    });

    expect(acknowledgedRes.success).toBe(true);
    if (!acknowledgedRes.success) throw new Error('Expected success');
    const secondClientId = acknowledgedRes.data.clientId;

    // Verify audit event has duplicate_acknowledged: true
    const [acknowledgedAudit] = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'client.created'), eq(auditEvents.targetId, secondClientId)),
      );

    expect(acknowledgedAudit).toBeDefined();
    if (!acknowledgedAudit) throw new Error('acknowledgedAudit not found');
    const meta = acknowledgedAudit.metadata;
    expect(meta).toBeDefined();
    if (!meta) throw new Error('meta not found');
    expect(meta.duplicate_acknowledged).toBe(true);
  });

  it('AC-4: enforces duplicate email detection and acknowledgment on addContactAction and updateContactAction', async () => {
    // Create Client A with primary contact email contactA@example.com
    const clientARes = await createClientAction({
      kind: 'person',
      displayName: 'Client A',
      primaryContact: {
        givenName: 'Person A',
        email: 'contactA@example.com',
      },
    });
    expect(clientARes.success).toBe(true);
    if (!clientARes.success) throw new Error('Expected success');
    const clientAId = clientARes.data.clientId;

    // Create Client B
    const clientBRes = await createClientAction({
      kind: 'person',
      displayName: 'Client B',
      primaryContact: {
        givenName: 'Person B',
        email: 'contactB@example.com',
      },
    });
    expect(clientBRes.success).toBe(true);
    if (!clientBRes.success) throw new Error('Expected success');
    const clientBId = clientBRes.data.clientId;

    // 1. addContactAction to Client B with Client A's email -> DUPLICATE_EMAIL
    const addDupRes = await addContactAction({
      clientId: clientBId,
      givenName: 'Person B2',
      email: ' ContactA@Example.COM ',
    });

    expect(addDupRes.success).toBe(false);
    expect(addDupRes.code).toBe('DUPLICATE_EMAIL');
    if (addDupRes.success) throw new Error('Expected failure');
    expect(addDupRes.duplicates).toEqual([{ clientId: clientAId, displayName: 'Client A' }]);

    // Add with acknowledgeDuplicates: true -> SUCCESS
    const addAckRes = await addContactAction({
      clientId: clientBId,
      givenName: 'Person B2',
      email: ' ContactA@Example.COM ',
      acknowledgeDuplicates: true,
    });
    expect(addAckRes.success).toBe(true);
    if (!addAckRes.success) throw new Error('Expected success');
    const contactB2Id = addAckRes.data.contactId;

    // 2. updateContactAction with duplicate email -> DUPLICATE_EMAIL
    const updateDupRes = await updateContactAction({
      clientId: clientBId,
      contactId: contactB2Id,
      email: 'contactB@example.com', // Already used by contact B1
    });

    expect(updateDupRes.success).toBe(false);
    expect(updateDupRes.code).toBe('DUPLICATE_EMAIL');

    // Update with acknowledgeDuplicates: true -> SUCCESS
    const updateAckRes = await updateContactAction({
      clientId: clientBId,
      contactId: contactB2Id,
      email: 'contactB@example.com',
      acknowledgeDuplicates: true,
    });
    expect(updateAckRes.success).toBe(true);
  });

  it('AC-5: updates contact isPrimary switching primary without concurrent second primary and DB partial index rejects direct duplicate primary', async () => {
    // Create client with contact A (primary)
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Primary Client',
      primaryContact: { givenName: 'Contact A' },
    });
    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error('Expected success');
    const clientId = createRes.data.clientId;

    // Add contact B (not primary)
    const addBRes = await addContactAction({
      clientId,
      givenName: 'Contact B',
      isPrimary: false,
    });
    expect(addBRes.success).toBe(true);
    if (!addBRes.success) throw new Error('Expected success');
    const contactBId = addBRes.data.contactId;

    // Promote B to primary
    const switchRes = await updateContactAction({
      clientId,
      contactId: contactBId,
      isPrimary: true,
    });
    expect(switchRes.success).toBe(true);

    // Verify B is primary, A is not
    const contacts = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId));

    const contactA = contacts.find((c) => c.givenName === 'Contact A');
    const contactB = contacts.find((c) => c.id === contactBId);

    expect(contactB?.isPrimary).toBe(true);
    expect(contactA?.isPrimary).toBe(false);

    // Verify DB partial unique index rejects a direct raw second primary insert
    await expect(
      testDb.client.query(
        `INSERT INTO client_contacts (id, client_id, given_name, is_primary, created_at, updated_at)
         VALUES ('01912345-6789-7abc-8def-0123456789aa', '${clientId}', 'Direct Second Primary', true, NOW(), NOW())`,
      ),
    ).rejects.toThrow(/client_contacts_client_id_primary_idx|unique constraint/i);
  });

  it('AC-6: removes contact; enforces CLIENT_NEEDS_CONTACT on single contact; promotes oldest remaining when primary removed', async () => {
    // 1. Single contact removal test
    const singleClientRes = await createClientAction({
      kind: 'person',
      displayName: 'Single Contact Client',
      primaryContact: { givenName: 'Sole Contact' },
    });
    expect(singleClientRes.success).toBe(true);
    if (!singleClientRes.success) throw new Error('Expected success');
    const singleClientId = singleClientRes.data.clientId;
    const [soleContact] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, singleClientId));
    expect(soleContact).toBeDefined();
    if (!soleContact) throw new Error('Expected soleContact');

    const removeSoleRes = await removeContactAction({
      clientId: singleClientId,
      contactId: soleContact.id,
    });

    expect(removeSoleRes.success).toBe(false);
    expect(removeSoleRes.code).toBe('CLIENT_NEEDS_CONTACT');

    // 2. Client with contacts A (primary, oldest) and B
    const clientRes = await createClientAction({
      kind: 'person',
      displayName: 'Two Contact Client',
      primaryContact: { givenName: 'Contact A (Oldest)' },
    });
    expect(clientRes.success).toBe(true);
    if (!clientRes.success) throw new Error('Expected success');
    const clientId = clientRes.data.clientId;
    const [contactA] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId));
    expect(contactA).toBeDefined();
    if (!contactA) throw new Error('Expected contactA');

    const addBRes = await addContactAction({
      clientId,
      givenName: 'Contact B (Newer)',
    });
    expect(addBRes.success).toBe(true);
    if (!addBRes.success) throw new Error('Expected success');
    const contactBId = addBRes.data.contactId;

    // Remove primary contact A
    const removeARes = await removeContactAction({
      clientId,
      contactId: contactA.id,
    });
    expect(removeARes.success).toBe(true);

    // Contact B must automatically be promoted to primary
    const [remainingB] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, contactBId));

    expect(remainingB).toBeDefined();
    expect(remainingB?.isPrimary).toBe(true);
  });

  it('AC-7: returns LIMIT_EXCEEDED when attempting to add an 11th contact to a client', async () => {
    const createRes = await createClientAction({
      kind: 'company',
      displayName: 'Corporate Client',
      primaryContact: { givenName: 'Contact 1' },
    });
    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error('Expected success');
    const clientId = createRes.data.clientId;

    // Add contacts 2 to 10 (reaching limit of 10)
    for (let i = 2; i <= 10; i++) {
      const addRes = await addContactAction({
        clientId,
        givenName: `Contact ${String(i)}`,
      });
      expect(addRes.success).toBe(true);
    }

    // 11th contact must be rejected with LIMIT_EXCEEDED
    const eleventhRes = await addContactAction({
      clientId,
      givenName: 'Contact 11',
    });

    expect(eleventhRes.success).toBe(false);
    expect(eleventhRes.code).toBe('LIMIT_EXCEEDED');

    const total = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId));
    expect(total.length).toBe(10);
  });

  it('AC-8: upsertAddressAction replaces existing address by type and removeAddressAction deletes it', async () => {
    const clientRes = await createClientAction({
      kind: 'person',
      displayName: 'Address Person',
      primaryContact: { givenName: 'Address Contact' },
    });
    expect(clientRes.success).toBe(true);
    if (!clientRes.success) throw new Error('Expected success');
    const clientId = clientRes.data.clientId;

    // 1. First upsert for postal address (Berlin)
    const upsert1 = await upsertAddressAction({
      clientId,
      type: 'postal',
      line1: 'Musterstraße 1',
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
    });
    expect(upsert1.success).toBe(true);

    // 2. Second upsert for postal address (Munich)
    const upsert2 = await upsertAddressAction({
      clientId,
      type: 'postal',
      line1: 'Marienplatz 1',
      postalCode: '80331',
      city: 'München',
      countryCode: 'DE',
    });
    expect(upsert2.success).toBe(true);

    // Exactly one postal address exists with city = 'München'
    const addrs = await dbClient
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, clientId));

    expect(addrs.length).toBe(1);
    expect(addrs[0]?.city).toBe('München');
    expect(addrs[0]?.line1).toBe('Marienplatz 1');

    // 3. removeAddressAction
    const removeRes = await removeAddressAction({ clientId, type: 'postal' });
    expect(removeRes.success).toBe(true);

    const remainingAddrs = await dbClient
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, clientId));
    expect(remainingAddrs.length).toBe(0);
  });

  it('AC-9: listClientsAction orders by display_name then id, paginates accurately, and rejects pageSize > 100', async () => {
    // Insert 30 clients
    for (let i = 1; i <= 30; i++) {
      const padded = String(i).padStart(2, '0');
      await createClientAction({
        kind: 'person',
        displayName: `Client ${padded}`,
        primaryContact: {
          givenName: `Given ${padded}`,
          familyName: `Family ${padded}`,
          email: `client${padded}@example.com`,
          phone: `+49 30 0000 00${padded}`,
        },
      });
    }

    // Call page 2 with pageSize 10 (items 11–20)
    const page2Res = await listClientsAction({ page: 2, pageSize: 10 });

    expect(page2Res.success).toBe(true);
    if (!page2Res.success) throw new Error('Expected success');
    const data = page2Res.data;
    expect(data.total).toBe(30);
    expect(data.page).toBe(2);
    expect(data.pageSize).toBe(10);
    expect(data.items.length).toBe(10);

    // Items 11 to 20
    expect(data.items[0]?.displayName).toBe('Client 11');
    expect(data.items[9]?.displayName).toBe('Client 20');

    // Verify item keys exactly match specification
    const firstItem = data.items[0];
    expect(firstItem).toBeDefined();
    if (!firstItem) throw new Error('Expected firstItem to be defined');
    expect(Object.keys(firstItem).sort()).toEqual(
      ['displayName', 'id', 'kind', 'primaryContact'].sort(),
    );
    expect(Object.keys(firstItem.primaryContact).sort()).toEqual(
      ['email', 'familyName', 'givenName', 'phone'].sort(),
    );

    // pageSize 101 must return VALIDATION_FAILED
    const overflowRes = await listClientsAction({ page: 1, pageSize: 101 });

    expect(overflowRes.success).toBe(false);
    expect(overflowRes.code).toBe('VALIDATION_FAILED');
  });

  it('AC-10: unauthenticated invocation of actions returns UNAUTHORIZED and no client data', async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();

    const listRes = await listClientsAction({});
    expect(listRes.success).toBe(false);
    expect(listRes.code).toBe('UNAUTHORIZED');
    if (listRes.success) throw new Error('Expected failure');
    expect(listRes.data).toBeUndefined();

    const getRes = await getClientAction({
      clientId: '01912345-6789-7abc-8def-012345678901',
    });
    expect(getRes.success).toBe(false);
    expect(getRes.code).toBe('UNAUTHORIZED');
    if (getRes.success) throw new Error('Expected failure');
    expect(getRes.data).toBeUndefined();

    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Anon Attempt',
      primaryContact: { givenName: 'Anon' },
    });
    expect(createRes.success).toBe(false);
    expect(createRes.code).toBe('UNAUTHORIZED');
    if (createRes.success) throw new Error('Expected failure');
    expect(createRes.data).toBeUndefined();
  });

  it('AC-11: API key with clients:read can read; write returns FORBIDDEN + denied audit event; non-owner returns FORBIDDEN', async () => {
    // Clear cookies so session does not override header
    mockCookiesStore.clear();

    // 1. Create API key with scope clients:read
    const { apiKey: readApiKey } = await createApiKey({
      userId: ownerUser.id,
      name: 'Read Only Key',
      scopes: ['clients:read'],
      client: dbClient,
    });

    mockHeadersStore.set('authorization', `Bearer ${readApiKey}`);

    // Read action succeeds
    const listRes = await listClientsAction({});
    expect(listRes.success).toBe(true);

    // Write action fails with FORBIDDEN
    const writeRes = await createClientAction({
      kind: 'person',
      displayName: 'Forbidden Write',
      primaryContact: { givenName: 'Key Person' },
    });

    expect(writeRes.success).toBe(false);
    expect(writeRes.code).toBe('FORBIDDEN');

    // Denied audit event recorded with actor_type: 'token'
    const deniedAudit = await dbClient
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'client.created'), eq(auditEvents.outcome, 'denied')));

    expect(deniedAudit.length).toBeGreaterThanOrEqual(1);
    expect(deniedAudit[0]?.actorType).toBe('token');

    // 2. API key without any clients:* scope fails on read actions
    const { apiKey: settingsKey } = await createApiKey({
      userId: ownerUser.id,
      name: 'Settings Only Key',
      scopes: ['settings:read'],
      client: dbClient,
    });

    mockHeadersStore.set('authorization', `Bearer ${settingsKey}`);

    const readWithoutScopeRes = await listClientsAction({});
    expect(readWithoutScopeRes.success).toBe(false);
    expect(readWithoutScopeRes.code).toBe('FORBIDDEN');

    // 3. Authenticated user whose role is not 'owner' gets FORBIDDEN on all actions
    mockHeadersStore.clear();

    const [nonOwnerUser] = await dbClient
      .insert(user)
      .values({
        name: 'Client Portal User',
        email: 'client-user@example.com',
        role: 'client',
      })
      .returning();

    expect(nonOwnerUser).toBeDefined();
    if (!nonOwnerUser) throw new Error('Expected nonOwnerUser');
    const nonOwnerSession = await createSession(nonOwnerUser.id, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, nonOwnerSession.token);

    const nonOwnerRead = await listClientsAction({});
    expect(nonOwnerRead.success).toBe(false);
    expect(nonOwnerRead.code).toBe('FORBIDDEN');

    const nonOwnerWrite = await createClientAction({
      kind: 'person',
      displayName: 'Non-Owner Write',
      primaryContact: { givenName: 'Hacker' },
    });
    expect(nonOwnerWrite.success).toBe(false);
    expect(nonOwnerWrite.code).toBe('FORBIDDEN');
  });

  it('AC-12: cross-client IDOR on updateContactAction or removeContactAction returns NOT_FOUND identical to non-existent UUID', async () => {
    // Create Client X
    const clientX = await createClientAction({
      kind: 'person',
      displayName: 'Client X',
      primaryContact: { givenName: 'Contact X' },
    });
    expect(clientX.success).toBe(true);
    if (!clientX.success) throw new Error('Expected success');
    const clientXId = clientX.data.clientId;

    // Create Client Y
    const clientY = await createClientAction({
      kind: 'person',
      displayName: 'Client Y',
      primaryContact: { givenName: 'Contact Y' },
    });
    expect(clientY.success).toBe(true);
    if (!clientY.success) throw new Error('Expected success');
    const clientYId = clientY.data.clientId;
    const [contactY] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientYId));
    expect(contactY).toBeDefined();
    if (!contactY) throw new Error('Expected contactY');

    // IDOR attempt: use Client X's ID with Contact Y's ID
    const idorUpdateRes = await updateContactAction({
      clientId: clientXId,
      contactId: contactY.id,
      givenName: 'Pwned',
    });

    // Call with random non-existent UUID
    const nonExistentUpdateRes = await updateContactAction({
      clientId: clientXId,
      contactId: '01912345-6789-7abc-8def-012345678999',
      givenName: 'Pwned',
    });

    // Responses must be completely identical (no existence oracle)
    expect(idorUpdateRes).toEqual(nonExistentUpdateRes);
    expect(idorUpdateRes.code).toBe('NOT_FOUND');

    // Contact Y remains unchanged
    const [verifiedY] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, contactY.id));
    expect(verifiedY?.givenName).toBe('Contact Y');

    // Same test for removeContactAction
    const idorRemoveRes = await removeContactAction({
      clientId: clientXId,
      contactId: contactY.id,
    });

    const nonExistentRemoveRes = await removeContactAction({
      clientId: clientXId,
      contactId: '01912345-6789-7abc-8def-012345678999',
    });

    expect(idorRemoveRes).toEqual(nonExistentRemoveRes);
    expect(idorRemoveRes.code).toBe('NOT_FOUND');
  });

  it('AC-13: write audit metadata contains only allowlisted keys, changed_fields field names only, and zero personal data', async () => {
    const syntheticName = 'Hermione Granger';
    const syntheticEmail = 'hermione@example.org';
    const syntheticPhone = '+49 30 0000 7777';
    const syntheticAddress = 'Diagon Alley 42';

    // 1. Create client
    const createRes = await createClientAction({
      kind: 'person',
      displayName: syntheticName,
      primaryContact: {
        givenName: 'Hermione',
        familyName: 'Granger',
        email: syntheticEmail,
        phone: syntheticPhone,
      },
    });
    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error('Expected success');
    const clientId = createRes.data.clientId;

    // 2. Update client
    await updateClientAction({
      clientId,
      displayName: 'Hermione Weasley',
    });

    // 3. Upsert address
    await upsertAddressAction({
      clientId,
      type: 'postal',
      line1: syntheticAddress,
      postalCode: '10115',
      city: 'London',
      countryCode: 'DE',
    });

    // Fetch all audit rows for this client
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, clientId));

    expect(auditRows.length).toBeGreaterThanOrEqual(3);

    for (const event of auditRows) {
      const meta = event.metadata;
      if (!meta) continue;

      const serialized = JSON.stringify(meta);

      // Verify no synthetic PII values exist in serialized metadata
      expect(serialized).not.toContain(syntheticName);
      expect(serialized).not.toContain(syntheticEmail);
      expect(serialized).not.toContain(syntheticPhone);
      expect(serialized).not.toContain(syntheticAddress);

      // Verify allowlisted keys only
      const keys = Object.keys(meta);
      const allowed = ['changed_fields', 'contact_id', 'address_type', 'duplicate_acknowledged'];
      for (const k of keys) {
        expect(allowed).toContain(k);
      }

      // Verify changed_fields contains only field names
      if ('changed_fields' in meta && Array.isArray(meta.changed_fields)) {
        for (const field of meta.changed_fields) {
          expect(typeof field).toBe('string');
          expect(field).not.toContain('Hermione');
          expect(field).not.toContain('Weasley');
        }
      }
    }
  });

  it('AC-14: logger output captured during AC-1, AC-3, and AC-12 flows contains zero synthetic PII', async () => {
    const syntheticName = 'Harry Potter';
    const syntheticEmail = 'harry.potter@example.org';
    const syntheticPhone = '+49 30 0000 8888';

    const loggedPayloads: string[] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation((...args: unknown[]) => {
      loggedPayloads.push(JSON.stringify(args));
    });

    try {
      // AC-1 flow
      const res1 = await createClientAction({
        kind: 'person',
        displayName: syntheticName,
        primaryContact: {
          givenName: 'Harry',
          familyName: 'Potter',
          email: syntheticEmail,
          phone: syntheticPhone,
        },
      });
      expect(res1.success).toBe(true);

      // AC-3 flow (duplicate detection)
      const res3 = await createClientAction({
        kind: 'person',
        displayName: 'Second Harry',
        primaryContact: {
          givenName: 'Harry',
          email: syntheticEmail,
        },
      });
      expect(res3.code).toBe('DUPLICATE_EMAIL');

      // AC-12 flow (cross-client IDOR)
      if (!res1.success) throw new Error('Expected success');
      await updateContactAction({
        clientId: res1.data.clientId,
        contactId: '01912345-6789-7abc-8def-012345678901',
        givenName: 'Attempt',
      });

      // Verify log outputs
      const combinedLogs = loggedPayloads.join(' ');
      expect(combinedLogs).not.toContain(syntheticName);
      expect(combinedLogs).not.toContain(syntheticEmail);
      expect(combinedLogs).not.toContain(syntheticPhone);
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
