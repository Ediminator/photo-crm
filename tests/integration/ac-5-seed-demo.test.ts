import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { seedDemo, generateDemoData, SAFE_EMAIL_DOMAINS } from '../../scripts/seed-demo.mjs';
import { getStudioSettings } from '@/server/settings/repo';

describe('AC-5: Deterministic synthetic demo seed and email safety', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-5: running seedDemo twice with the same seed produces identical data', () => {
    const run1 = generateDemoData(42);
    const run2 = generateDemoData(42);

    expect(run1).toEqual(run2);
    expect(run1.settings.id).toBe(run2.settings.id);
    expect(run1.contacts.map((c) => c.email)).toEqual(run2.contacts.map((c) => c.email));
    expect(run1.contacts.map((c) => c.id)).toEqual(run2.contacts.map((c) => c.id));
  });

  it('AC-5: all generated email addresses end in example.com or example.org and no other domains exist', () => {
    // Test across several arbitrary seeds to ensure invariant holds across generation
    for (const seed of [1, 42, 999, 12345]) {
      const demoData = generateDemoData(seed);

      expect(demoData.contacts.length).toBeGreaterThan(0);

      for (const contact of demoData.contacts) {
        const domain = contact.email.split('@')[1] ?? '';
        expect(
          SAFE_EMAIL_DOMAINS.includes(domain),
          `Email "${contact.email}" has unpermitted domain "${domain}". Only example.com and example.org are permitted.`,
        ).toBe(true);

        // Disallow common public email providers
        expect(contact.email).not.toMatch(/@(gmail|yahoo|hotmail|outlook|gmx|web)\./i);
      }
    }
  });

  it('AC-5: executes seedDemo against test database and writes deterministic studio settings', async () => {
    const result = await seedDemo({
      dbClient: testDb.db,
      seed: 42,
      forceDemo: true,
      nodeEnv: 'test',
    });

    expect(result.success).toBe(true);

    const persisted = await getStudioSettings(testDb.db);
    expect(persisted.studio_name).toBe(result.data.settings.studio_name);
    expect(persisted.timezone).toBe('Europe/Berlin');
    expect(persisted.currency).toBe('EUR');
  });
});
