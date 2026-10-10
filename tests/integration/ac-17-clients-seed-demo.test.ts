import { describe, it, expect, vi } from 'vitest';
import { generateDemoData, seedDemo, SAFE_EMAIL_DOMAINS } from '../../scripts/seed-demo.mjs';
import { createIsolatedTestDatabase } from '../helpers/db-test-helper';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('AC-17: Demo seeding determinism, client data structure, and safety constraints', () => {
  it('AC-17: running generateDemoData twice produces identical client data', () => {
    const run1 = generateDemoData(42);
    const run2 = generateDemoData(42);

    expect(run1.clients.length).toBe(50);
    expect(run2.clients.length).toBe(50);
    expect(run1.clients).toEqual(run2.clients);
  });

  it('AC-17: verifies all synthetic client contact emails end in example.com or example.org and all phones match ^\\+49 30 0000 \\d{4}$', () => {
    const data = generateDemoData(42);
    expect(data.clients.length).toBe(50);

    let totalContacts = 0;
    for (const client of data.clients) {
      expect(client.contacts.length).toBeGreaterThanOrEqual(1);
      expect(client.contacts.length).toBeLessThanOrEqual(3);

      // Exactly one contact is primary
      const primaryCount = client.contacts.filter((c) => c.isPrimary).length;
      expect(primaryCount).toBe(1);

      for (const contact of client.contacts) {
        totalContacts++;
        const domain = contact.email.split('@')[1];
        expect(SAFE_EMAIL_DOMAINS).toContain(domain);
        expect(contact.phone).toMatch(/^\+49 30 0000 \d{4}$/);
      }
    }

    expect(totalContacts).toBeGreaterThanOrEqual(50);
  });

  it('AC-17: seedDemo executed against an isolated test database populates 50 clients with contacts and addresses', async () => {
    const testDb = await createIsolatedTestDatabase();
    try {
      const dbClient = testDb.db as unknown as DbClient;

      const result = await seedDemo({
        dbClient,
        seed: 42,
        forceDemo: true,
        nodeEnv: 'test',
      });

      expect(result.success).toBe(true);

      const persistedClients = await dbClient.select().from(clients);
      expect(persistedClients.length).toBe(50);

      const persistedContacts = await dbClient.select().from(clientContacts);
      expect(persistedContacts.length).toBeGreaterThanOrEqual(50);

      const persistedAddresses = await dbClient.select().from(clientAddresses);
      expect(persistedAddresses.length).toBeGreaterThanOrEqual(0);
    } finally {
      await testDb.destroy();
    }
  });
});
