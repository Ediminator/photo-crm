import { describe, it, expect } from 'vitest';
import {
  validatePasswordPolicy,
  hashPasswordArgon2id,
  verifyPasswordArgon2id,
} from '@/server/auth/passwords/policy';

describe('AC-3: Password policy validation and Argon2id hashing', () => {
  it('AC-3: rejects password shorter than 12 characters with localized error code', () => {
    const result = validatePasswordPolicy('Short1!');
    expect(result.valid).toBe(false);
    expect(result.code).toBe('TOO_SHORT');
    expect(result.message).toContain('at least 12 characters');
  });

  it('AC-3: rejects common passwords on the bundled offline blacklist', () => {
    const commonList = [
      'password1234',
      'password12345',
      '123456789012',
      'qwertyuiop12',
      'adminadmin123',
      'welcome123456',
    ];

    for (const common of commonList) {
      const result = validatePasswordPolicy(common);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('COMMON_PASSWORD');
      expect(result.message).toContain('too common');
    }
  });

  it('AC-3: accepts a 64-character passphrase containing spaces and emoji', () => {
    // 64-character passphrase with spaces, emoji, and symbols
    const emojiPassphrase = '📸 Studio Master Key 2026! A very safe and robust passphrase 🌟🎉';
    const result = validatePasswordPolicy(emojiPassphrase);
    expect(result.valid).toBe(true);
    expect(result.code).toBeUndefined();
  });

  it('AC-3: hashes password with Argon2id and verifies match and mismatch correctly', async () => {
    const password = 'CorrectHorseBatteryStaple123!';
    const hash = await hashPasswordArgon2id(password);

    // Verify hash format contains argon2id with m=65536, t=3, p=4
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=65536,t=3,p=4');

    const isValid = await verifyPasswordArgon2id(hash, password);
    expect(isValid).toBe(true);

    const isWrong = await verifyPasswordArgon2id(hash, 'WrongPassword123!');
    expect(isWrong).toBe(false);

    // Malformed hash returns false safely without throwing
    const malformed = await verifyPasswordArgon2id('invalid-argon2-hash-format', password);
    expect(malformed).toBe(false);
  });

  it('AC-3: rejects password longer than 1024 characters or non-string input', () => {
    const tooLong = 'a'.repeat(1025);
    const longRes = validatePasswordPolicy(tooLong);
    expect(longRes.valid).toBe(false);
    expect(longRes.code).toBe('TOO_LONG');
    expect(longRes.message).toContain('cannot exceed 1024');

    const nonString = validatePasswordPolicy(null as unknown as string);
    expect(nonString.valid).toBe(false);
    expect(nonString.code).toBe('TOO_SHORT');
  });
});
