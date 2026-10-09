import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { getStudioSettings, updateStudioSettings } from '@/server/settings/repo';
import { SettingsValidationError } from '@/server/settings/schema';

describe('AC-3: Studio settings repository and validation enforcement', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-3: getStudioSettings initializes default studio settings when table is empty', async () => {
    const settings = await getStudioSettings(testDb.db);
    expect(settings).toBeDefined();
    expect(settings.studio_name).toBe('Photo Studio');
    expect(settings.default_locale).toBe('en');
    expect(settings.timezone).toBe('UTC');
    expect(settings.currency).toBe('EUR');
    expect(settings.id).toBeDefined();
    expect(settings.created_at).toBeInstanceOf(Date);
    expect(settings.updated_at).toBeInstanceOf(Date);
  });

  it('AC-3: updateStudioSettings updates studio settings with valid input', async () => {
    const initial = await getStudioSettings(testDb.db);

    const updated = await updateStudioSettings(
      {
        studio_name: 'Studio Klee Hamburg',
        default_locale: 'de',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
      },
      testDb.db,
    );

    expect(updated.id).toBe(initial.id);
    expect(updated.studio_name).toBe('Studio Klee Hamburg');
    expect(updated.default_locale).toBe('de');
    expect(updated.timezone).toBe('Europe/Berlin');
    expect(updated.currency).toBe('EUR');

    // Confirm persisted in database
    const refreshed = await getStudioSettings(testDb.db);
    expect(refreshed.studio_name).toBe('Studio Klee Hamburg');
    expect(refreshed.default_locale).toBe('de');
  });

  it('AC-3: rejects invalid time zone with typed SettingsValidationError and writes nothing', async () => {
    const initial = await getStudioSettings(testDb.db);

    await expect(
      updateStudioSettings(
        {
          studio_name: 'Should Not Persist',
          default_locale: 'en',
          timezone: 'Mars/Curiosity',
          currency: 'EUR',
        },
        testDb.db,
      ),
    ).rejects.toThrow(SettingsValidationError);

    // Verify nothing was written to the database
    const current = await getStudioSettings(testDb.db);
    expect(current.studio_name).toBe(initial.studio_name);
    expect(current.timezone).toBe(initial.timezone);
  });

  it('AC-3: rejects unsupported locale with typed SettingsValidationError and writes nothing', async () => {
    const initial = await getStudioSettings(testDb.db);

    await expect(
      updateStudioSettings(
        {
          studio_name: 'Should Not Persist',
          default_locale: 'es' as unknown as 'en',
          timezone: 'Europe/Berlin',
          currency: 'EUR',
        },
        testDb.db,
      ),
    ).rejects.toThrow(SettingsValidationError);

    // Verify nothing was written to the database
    const current = await getStudioSettings(testDb.db);
    expect(current.studio_name).toBe(initial.studio_name);
    expect(current.default_locale).toBe(initial.default_locale);
  });

  it('AC-3: rejects unsupported currency code with typed SettingsValidationError and writes nothing', async () => {
    const initial = await getStudioSettings(testDb.db);

    await expect(
      updateStudioSettings(
        {
          studio_name: 'Should Not Persist',
          default_locale: 'en',
          timezone: 'Europe/Berlin',
          currency: 'XYZ',
        },
        testDb.db,
      ),
    ).rejects.toThrow(SettingsValidationError);

    // Verify nothing was written to the database
    const current = await getStudioSettings(testDb.db);
    expect(current.studio_name).toBe(initial.studio_name);
    expect(current.currency).toBe(initial.currency);
  });
});
