import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { listClients, getClientById } from '@/server/clients/repo';
import type { DbClient } from '@/server/db/client';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import { generateDeterministicUuidV7 } from '../../scripts/seed-demo.mjs';
import { faker } from '@faker-js/faker';

describe('TASK-0011: Clients Directory & Profile Integration (AC-1 to AC-5)', () => {
  let testDb: TestDatabaseInstance;
  let db: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    db = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: Given 30 clients exist in database, listClients returns first 25 in name order and page 2 returns remaining 5', async () => {
    const baseTs = 1770000000000;
    faker.seed(42);

    // Seed 30 clients with deterministic names
    for (let i = 1; i <= 30; i++) {
      const clientId = generateDeterministicUuidV7(faker, baseTs + i * 1000);
      const contactId = generateDeterministicUuidV7(faker, baseTs + i * 1000 + 10);
      const displayName = `Client ${String(i).padStart(2, '0')}`;

      await db.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName,
        preferredLocale: 'en',
        lastActivityAt: new Date(baseTs),
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      });

      const strI = String(i);
      await db.insert(clientContacts).values({
        id: contactId,
        clientId,
        givenName: `First${strI}`,
        familyName: `Last${strI}`,
        email: `client.${strI}@example.com`,
        emailNormalized: `client.${strI}@example.com`,
        phone: `+49 30 0000 ${String(i).padStart(4, '0')}`,
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      });
    }

    // Page 1: 25 items
    const page1 = await listClients({ page: 1, pageSize: 25 }, db);
    expect(page1.total).toBe(30);
    expect(page1.items.length).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(25);
    expect(page1.items[0]?.displayName).toBe('Client 01');
    expect(page1.items[24]?.displayName).toBe('Client 25');

    // Page 2: remaining 5 items
    const page2 = await listClients({ page: 2, pageSize: 25 }, db);
    expect(page2.total).toBe(30);
    expect(page2.items.length).toBe(5);
    expect(page2.page).toBe(2);
    expect(page2.items[0]?.displayName).toBe('Client 26');
    expect(page2.items[4]?.displayName).toBe('Client 30');
  });

  it('AC-2: Given contact email search term, listClients returns only matching client', async () => {
    const baseTs = 1770000000000;
    faker.seed(101);

    const client1Id = generateDeterministicUuidV7(faker, baseTs + 1000);
    const client2Id = generateDeterministicUuidV7(faker, baseTs + 2000);

    await db.insert(clients).values([
      {
        id: client1Id,
        kind: 'person',
        displayName: 'Alice Wonderland',
        preferredLocale: 'en',
        lastActivityAt: new Date(baseTs),
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
      {
        id: client2Id,
        kind: 'person',
        displayName: 'Bob Builder',
        preferredLocale: 'de',
        lastActivityAt: new Date(baseTs),
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
    ]);

    await db.insert(clientContacts).values([
      {
        id: generateDeterministicUuidV7(faker, baseTs + 1010),
        clientId: client1Id,
        givenName: 'Alice',
        familyName: 'Wonderland',
        email: 'alice.unique@example.com',
        emailNormalized: 'alice.unique@example.com',
        phone: '+49 30 0000 1111',
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
      {
        id: generateDeterministicUuidV7(faker, baseTs + 2010),
        clientId: client2Id,
        givenName: 'Bob',
        familyName: 'Builder',
        email: 'bob.other@example.com',
        emailNormalized: 'bob.other@example.com',
        phone: '+49 30 0000 2222',
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
    ]);

    const result = await listClients({ q: 'alice.unique@example.com' }, db);
    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.displayName).toBe('Alice Wonderland');
  });

  it('AC-3: combines tag filter and search term with AND logic', async () => {
    const baseTs = 1770000000000;
    faker.seed(202);

    const client1Id = generateDeterministicUuidV7(faker, baseTs + 1000);
    const client2Id = generateDeterministicUuidV7(faker, baseTs + 2000);
    const tagWeddingId = generateDeterministicUuidV7(faker, baseTs + 3000);

    await db.insert(tags).values({
      id: tagWeddingId,
      name: 'Wedding',
      nameNormalized: 'wedding',
      createdAt: new Date(baseTs),
      updatedAt: new Date(baseTs),
    });

    await db.insert(clients).values([
      {
        id: client1Id,
        kind: 'person',
        displayName: 'Sarah Connor',
        preferredLocale: 'en',
        lastActivityAt: new Date(baseTs),
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
      {
        id: client2Id,
        kind: 'person',
        displayName: 'Sarah Miller',
        preferredLocale: 'en',
        lastActivityAt: new Date(baseTs),
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
    ]);

    await db.insert(clientContacts).values([
      {
        id: generateDeterministicUuidV7(faker, baseTs + 1010),
        clientId: client1Id,
        givenName: 'Sarah',
        familyName: 'Connor',
        email: 'sarah.connor@example.com',
        emailNormalized: 'sarah.connor@example.com',
        phone: '+49 30 0000 3333',
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
      {
        id: generateDeterministicUuidV7(faker, baseTs + 2010),
        clientId: client2Id,
        givenName: 'Sarah',
        familyName: 'Miller',
        email: 'sarah.miller@example.com',
        emailNormalized: 'sarah.miller@example.com',
        phone: '+49 30 0000 4444',
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
    ]);

    // Only client1 has tag 'Wedding'
    await db.insert(clientTags).values({
      clientId: client1Id,
      tagId: tagWeddingId,
      createdAt: new Date(baseTs),
    });

    // Search 'Sarah' with tagWeddingId matches only client1
    const result = await listClients({ q: 'Sarah', tagId: tagWeddingId }, db);
    expect(result.total).toBe(1);
    expect(result.items[0]?.displayName).toBe('Sarah Connor');
    expect(result.items[0]?.tags.some((t) => t.name === 'Wedding')).toBe(true);
  });

  it('AC-4: search that matches nothing returns total=0 and items=[]', async () => {
    const result = await listClients({ q: 'nonexistent-term-xyz' }, db);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('AC-5: getClientById returns client with all relations including primary contact, addresses, and tags', async () => {
    const baseTs = 1770000000000;
    faker.seed(303);

    const clientId = generateDeterministicUuidV7(faker, baseTs + 1000);
    const tagId = generateDeterministicUuidV7(faker, baseTs + 2000);

    await db.insert(tags).values({
      id: tagId,
      name: 'Corporate',
      nameNormalized: 'corporate',
      createdAt: new Date(baseTs),
      updatedAt: new Date(baseTs),
    });

    await db.insert(clients).values({
      id: clientId,
      kind: 'company',
      displayName: 'Starlight Media GmbH',
      preferredLocale: 'de',
      lastActivityAt: new Date(baseTs),
      createdAt: new Date(baseTs),
      updatedAt: new Date(baseTs),
    });

    await db.insert(clientContacts).values([
      {
        id: generateDeterministicUuidV7(faker, baseTs + 1010),
        clientId,
        givenName: 'Maximilian',
        familyName: 'Mustermann',
        email: 'max@example.com',
        emailNormalized: 'max@example.com',
        phone: '+49 30 0000 5555',
        isPrimary: true,
        createdAt: new Date(baseTs),
        updatedAt: new Date(baseTs),
      },
      {
        id: generateDeterministicUuidV7(faker, baseTs + 1020),
        clientId,
        givenName: 'Erika',
        familyName: 'Mustermann',
        email: 'erika@example.org',
        emailNormalized: 'erika@example.org',
        phone: '+49 30 0000 6666',
        isPrimary: false,
        createdAt: new Date(baseTs + 60000),
        updatedAt: new Date(baseTs + 60000),
      },
    ]);

    await db.insert(clientAddresses).values({
      id: generateDeterministicUuidV7(faker, baseTs + 1030),
      clientId,
      type: 'postal',
      line1: 'Friedrichstraße 100',
      line2: 'Aufgang B',
      postalCode: '10117',
      city: 'Berlin',
      region: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date(baseTs),
      updatedAt: new Date(baseTs),
    });

    await db.insert(clientTags).values({
      clientId,
      tagId,
      createdAt: new Date(baseTs),
    });

    const clientWithRel = await getClientById(clientId, db);
    expect(clientWithRel).not.toBeNull();
    expect(clientWithRel?.client.displayName).toBe('Starlight Media GmbH');
    expect(clientWithRel?.client.kind).toBe('company');
    expect(clientWithRel?.client.preferredLocale).toBe('de');

    // 2 contacts, primary is marked
    expect(clientWithRel?.contacts.length).toBe(2);
    const primary = clientWithRel?.contacts.find((c) => c.isPrimary);
    expect(primary?.givenName).toBe('Maximilian');
    expect(primary?.email).toBe('max@example.com');

    // Address
    expect(clientWithRel?.addresses.length).toBe(1);
    expect(clientWithRel?.addresses[0]?.line1).toBe('Friedrichstraße 100');
    expect(clientWithRel?.addresses[0]?.countryCode).toBe('DE');

    // Tags
    expect(clientWithRel?.tags.length).toBe(1);
    expect(clientWithRel?.tags[0]?.name).toBe('Corporate');
  });
});
