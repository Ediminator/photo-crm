import { describe, it, expect } from 'vitest';
import { clientSchema, validateClientEnv, clientEnv, EnvValidationError } from '@/env';

describe('AC-4: Client environment isolation (NEXT_PUBLIC_ boundary)', () => {
  it('AC-4: clientSchema only defines keys starting with NEXT_PUBLIC_', () => {
    const keys = Object.keys(clientSchema.shape);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(
        key.startsWith('NEXT_PUBLIC_'),
        `Key ${key} in clientSchema does not start with NEXT_PUBLIC_`,
      ).toBe(true);
    }
  });

  it('AC-4: non-NEXT_PUBLIC_ variables are completely inaccessible in client env', () => {
    const contaminatedEnv = {
      AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
      POSTGRES_PASSWORD: 'secret_db_password_never_leak',
      STORAGE_SECRET_KEY: 'secret_minio_password_never_leak',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'de',
    };

    const validated = validateClientEnv(contaminatedEnv);

    // Non-NEXT_PUBLIC_ variables must not exist on the client env object
    expect('AUTH_SECRET' in validated).toBe(false);
    expect('DATABASE_URL' in validated).toBe(false);
    expect('POSTGRES_PASSWORD' in validated).toBe(false);
    expect('STORAGE_SECRET_KEY' in validated).toBe(false);

    expect((validated as Record<string, unknown>).AUTH_SECRET).toBeUndefined();
    expect((validated as Record<string, unknown>).DATABASE_URL).toBeUndefined();

    // Only allowed NEXT_PUBLIC_ keys are present
    const returnedKeys = Object.keys(validated);
    for (const key of returnedKeys) {
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
    }
  });

  it('AC-4: clientSchema strictly rejects objects with non-NEXT_PUBLIC_ keys', () => {
    const rawDirectObject = {
      AUTH_SECRET: 'some_secret',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'en',
    };

    // Because clientSchema has .strict(), parsing raw unrecognized keys directly throws
    expect(() => clientSchema.parse(rawDirectObject)).toThrow(/unrecognized/i);
  });

  it('AC-4: validateClientEnv applies default values for client variables', () => {
    const emptyEnv = {};
    const validated = validateClientEnv(emptyEnv);

    expect(validated.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(validated.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('en');
  });

  it('AC-4: validateClientEnv rejects unsupported locales', () => {
    const invalidLocaleEnv = {
      NEXT_PUBLIC_DEFAULT_LOCALE: 'fr',
    };

    expect(() => validateClientEnv(invalidLocaleEnv)).toThrow(EnvValidationError);
  });

  it('AC-4: clientEnv export is immutable (frozen)', () => {
    expect(Object.isFrozen(clientEnv)).toBe(true);
  });
});
