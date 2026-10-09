import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  serverSchema,
  validateServerEnv,
  validateSecretStrength,
  EnvValidationError,
  resetEnvCache,
  env,
} from '@/env';

describe('AC-3: Server environment validation and secret strength enforcement', () => {
  const originalEnv = { ...process.env };

  const validServerEnvInput = {
    NODE_ENV: 'test',
    PORT: '3000',
    AUTH_URL: 'http://localhost:3000',
    // 64-char valid random hex string (32 bytes)
    AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
    DATABASE_URL: 'postgres://photo_crm_app:password@127.0.0.1:5432/photo_crm_dev',
    MIGRATION_DATABASE_URL: 'postgres://photo_crm_migrator:password@127.0.0.1:5432/photo_crm_dev',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM: 'noreply@example.com',
    STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    STORAGE_PORT: '9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'valid_access_key_123',
    // 64-char valid hex
    STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b',
    STORAGE_BUCKET_UPLOADS: 'photo-crm-uploads',
    STORAGE_USE_SSL: 'false',
  };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-3: validates a fully compliant server environment successfully', () => {
    const validated = validateServerEnv(validServerEnvInput);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.PORT).toBe(3000);
    expect(validated.AUTH_SECRET).toBe(validServerEnvInput.AUTH_SECRET);
    expect(validated.STORAGE_USE_SSL).toBe(false);
  });

  it('AC-3: throws EnvValidationError when required variable AUTH_SECRET is missing', () => {
    const invalidInput = { ...validServerEnvInput };
    delete (invalidInput as Record<string, unknown>).AUTH_SECRET;

    expect(() => validateServerEnv(invalidInput)).toThrow(EnvValidationError);

    try {
      validateServerEnv(invalidInput);
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.issues.some((i) => i.key === 'AUTH_SECRET')).toBe(true);
      expect(valErr.message).toContain('AUTH_SECRET');
    }
  });

  it('AC-3: throws EnvValidationError when required variable DATABASE_URL is missing', () => {
    const invalidInput = { ...validServerEnvInput };
    delete (invalidInput as Record<string, unknown>).DATABASE_URL;

    expect(() => validateServerEnv(invalidInput)).toThrow(EnvValidationError);

    try {
      validateServerEnv(invalidInput);
    } catch (err) {
      const valErr = err as EnvValidationError;
      expect(valErr.issues.some((i) => i.key === 'DATABASE_URL')).toBe(true);
      expect(valErr.message).toContain('DATABASE_URL');
    }
  });

  it('AC-3: rejects malformed DATABASE_URL without leaking input value', () => {
    const leakCanary = 'super_secret_db_pass_xyz123';
    const invalidInput = {
      ...validServerEnvInput,
      DATABASE_URL: `http://invalid-db-protocol:${leakCanary}@localhost/db`,
    };

    try {
      validateServerEnv(invalidInput);
      expect.unreachable('Should have thrown EnvValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.message).not.toContain(leakCanary);
      expect(valErr.message).toContain('DATABASE_URL');
    }
  });

  it('AC-3: rejects weak placeholder secrets (changeme, password, secret, admin) without leaking the secret', () => {
    const placeholders = [
      'changeme_random_suffix_1234567890abcdef',
      'password_super_strong_looking_suffix_1234',
      'my_super_secret_value_with_enough_entropy_12345',
      'admin_root_master_key_long_enough_string_here',
    ];

    for (const weakSecret of placeholders) {
      const invalidInput = {
        ...validServerEnvInput,
        AUTH_SECRET: weakSecret,
      };

      try {
        validateServerEnv(invalidInput);
        expect.unreachable(`Should have rejected weak secret: ${weakSecret}`);
      } catch (err) {
        expect(err).toBeInstanceOf(EnvValidationError);
        const valErr = err as EnvValidationError;
        expect(valErr.message).toContain('AUTH_SECRET');
        // Ensure secret value is never printed in the error message
        expect(valErr.message).not.toContain(weakSecret);
      }
    }
  });

  it('AC-3: rejects secrets with insufficient length (< 32 bytes) or low entropy', () => {
    // 16 bytes hex (32 hex characters, no placeholder substring)
    const shortHex = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
    // Low entropy (repeated characters, diversity < 8)
    const lowEntropy = 'aabbccddeeff'.repeat(6);

    expect(() => {
      validateSecretStrength(shortHex, 'AUTH_SECRET');
    }).toThrow(/must be at least 64 characters/);

    expect(() => {
      validateSecretStrength(lowEntropy, 'AUTH_SECRET');
    }).toThrow(/low character diversity/);
  });

  it('AC-3: accepts valid base64-encoded secret with at least 32 decoded bytes', () => {
    // 32 random bytes encoded as base64 (44 characters)
    const base64Secret = 'u1Fq7gY3xN9zP2wK5mC8rT0vJ4bH6eQ1lS3dA5oX7yM=';
    expect(() => {
      validateSecretStrength(base64Secret, 'AUTH_SECRET');
    }).not.toThrow();

    const result = validateServerEnv({
      ...validServerEnvInput,
      AUTH_SECRET: base64Secret,
    });
    expect(result.AUTH_SECRET).toBe(base64Secret);
  });

  it('AC-3: throws error when env proxy is accessed in client/browser runtime', () => {
    // Simulate browser window object
    const globalAny = globalThis as { window?: unknown };
    const originalWindow = globalAny.window;
    try {
      globalAny.window = {};

      expect(() => env.DATABASE_URL).toThrow(
        /Server environment variables cannot be accessed on the client/,
      );
    } finally {
      globalAny.window = originalWindow;
    }
  });

  it('AC-3: serverSchema transforms PORT and STORAGE_USE_SSL correctly', () => {
    const parsed = serverSchema.parse({
      ...validServerEnvInput,
      PORT: '8080',
      STORAGE_USE_SSL: 'true',
    });

    expect(parsed.PORT).toBe(8080);
    expect(parsed.STORAGE_USE_SSL).toBe(true);
  });

  it('AC-3: validateSecretStrength handles invalid types and edge cases', () => {
    expect(() => {
      validateSecretStrength(null, 'AUTH_SECRET');
    }).toThrow(/is required/);
    expect(() => {
      validateSecretStrength('', 'AUTH_SECRET');
    }).toThrow(/is required/);
    expect(() => {
      validateSecretStrength(12345, 'AUTH_SECRET');
    }).toThrow(/is required/);

    // Base64 string of length 40 that decodes to 30 bytes (< 32 bytes)
    const shortBase64 = 'OWY4ZTdkNmM1YjRhM2YyZTFkMGM5YjhhN2Y2ZTVk';
    expect(() => {
      validateSecretStrength(shortBase64, 'AUTH_SECRET');
    }).toThrow(/must decode to at least 32 bytes/);

    // Non-hex, non-base64 symbol string of length 20 (< 32 bytes) with high entropy
    const shortSymbols = '!@#$%^&*()_+~`|}{[];';
    expect(() => {
      validateSecretStrength(shortSymbols, 'AUTH_SECRET');
    }).toThrow(/must be at least 32 bytes in length/);
  });

  it('AC-3: rejects weak or placeholder STORAGE_SECRET_KEY', () => {
    const invalidInput = {
      ...validServerEnvInput,
      STORAGE_SECRET_KEY: 'changeme_minio_key_1234567890',
    };

    expect(() => validateServerEnv(invalidInput)).toThrow(EnvValidationError);
  });

  it('AC-3: getServerEnv caches validated result and env proxy accesses properties on server', () => {
    Object.assign(process.env, validServerEnvInput);
    resetEnvCache();

    // env proxy works on server
    expect(env.PORT).toBe(3000);
    expect(env.AUTH_URL).toBe('http://localhost:3000');

    // Calling validateServerEnv with no arguments uses process.env
    const validated = validateServerEnv();
    expect(validated.NODE_ENV).toBe('test');
  });
});
