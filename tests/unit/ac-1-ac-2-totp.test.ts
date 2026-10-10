import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  getOtpauthUri,
  generateTotpQrSvg,
  generateTotpCode,
  verifyTotpCode,
  generateRecoveryCodes,
  verifyRecoveryCode,
  base32Encode,
  base32Decode,
} from '@/server/auth/totp';

describe('AC-1 & AC-2: TOTP and Recovery Codes Cryptography and Replay Logic', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(64);
  });

  it('I1-S04: throws explicit error when AUTH_SECRET is missing or shorter than 32 characters', () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptTotpSecret('JBSWY3DPEHPK3PXP')).toThrow(
      'AUTH_SECRET is required and must be at least 32 characters to derive TOTP encryption key.',
    );

    process.env.AUTH_SECRET = 'short-secret';
    expect(() => encryptTotpSecret('JBSWY3DPEHPK3PXP')).toThrow(
      'AUTH_SECRET is required and must be at least 32 characters to derive TOTP encryption key.',
    );

    process.env.AUTH_SECRET = 'a'.repeat(64);
  });

  it('AC-1: generates valid base32 secret and encrypts/decrypts cleanly at rest with AES-256-GCM', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const encrypted = encryptTotpSecret(secret);
    expect(encrypted).toContain(':');
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3); // iv : tag : ciphertext

    const decrypted = decryptTotpSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('AC-1: decryptTotpSecret fails if ciphertext or auth tag is tampered with', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    const parts = encrypted.split(':');
    const iv = parts[0] ?? '';
    const tag = parts[1] ?? '';
    const ciphertext = parts[2] ?? '';

    // Tamper with ciphertext
    const tamperedCiphertext = ciphertext.slice(0, -2) + (ciphertext.endsWith('a') ? 'b' : 'a');
    expect(() => decryptTotpSecret(`${iv}:${tag}:${tamperedCiphertext}`)).toThrow();

    // Tamper with tag (alter byte content while maintaining 16-byte length)
    const tamperedTag = tag.slice(0, -2) + (tag.endsWith('00') ? '11' : '00');
    expect(() => decryptTotpSecret(`${iv}:${tamperedTag}:${ciphertext}`)).toThrow();
  });

  it('AC-1: formats standard otpauth URI and renders purely self-hosted vector SVG QR code', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = getOtpauthUri(secret, 'owner@example.com', 'Ownlight');
    expect(uri).toContain('otpauth://totp/Ownlight:owner%40example.com');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=Ownlight');

    const svg = generateTotpQrSvg(uri);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('</svg>');
    // Must NOT contain any third-party external CDN, script or image references
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('google');
    expect(svg).not.toContain('https://');
  });

  it('AC-1: generateTotpCode produces 6-digit zero-padded numeric string', () => {
    const secret = generateTotpSecret();
    const currentStep = Math.floor(Date.now() / 30000);
    const code = generateTotpCode(secret, currentStep);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('AC-2: verifyTotpCode accepts codes within ±1 time-step (30s) tolerance window', () => {
    const secret = generateTotpSecret();
    const currentStep = Math.floor(Date.now() / 30000);

    const prevCode = generateTotpCode(secret, currentStep - 1);
    const currCode = generateTotpCode(secret, currentStep);
    const nextCode = generateTotpCode(secret, currentStep + 1);

    expect(verifyTotpCode(secret, prevCode).valid).toBe(true);
    expect(verifyTotpCode(secret, currCode).valid).toBe(true);
    expect(verifyTotpCode(secret, nextCode).valid).toBe(true);

    // Beyond ±1 time-step must be rejected
    const tooOldCode = generateTotpCode(secret, currentStep - 2);
    const tooFutureCode = generateTotpCode(secret, currentStep + 2);
    expect(verifyTotpCode(secret, tooOldCode).valid).toBe(false);
    expect(verifyTotpCode(secret, tooFutureCode).valid).toBe(false);
  });

  it('AC-2: verifyTotpCode enforces replay prevention: a code already used in the window is rejected', () => {
    const secret = generateTotpSecret();
    const currentStep = Math.floor(Date.now() / 30000);
    const currCode = generateTotpCode(secret, currentStep);

    // First use at currentStep is valid
    const firstCheck = verifyTotpCode(secret, currCode, currentStep - 1);
    expect(firstCheck.valid).toBe(true);
    expect(firstCheck.step).toBe(currentStep);

    // Replay attempt with lastUsedStep = currentStep MUST be rejected
    const replayCheck = verifyTotpCode(secret, currCode, currentStep);
    expect(replayCheck.valid).toBe(false);

    // An older code in the window (currentStep - 1) is also rejected if lastUsedStep is currentStep
    const olderCode = generateTotpCode(secret, currentStep - 1);
    const olderReplayCheck = verifyTotpCode(secret, olderCode, currentStep);
    expect(olderReplayCheck.valid).toBe(false);

    // A future step code is accepted
    const futureCode = generateTotpCode(secret, currentStep + 1);
    const futureCheck = verifyTotpCode(secret, futureCode, currentStep);
    expect(futureCheck.valid).toBe(true);
    expect(futureCheck.step).toBe(currentStep + 1);
  });

  it('AC-3: generates 10 single-use formatted recovery codes with scrypt hashes', () => {
    const { plaintext, records } = generateRecoveryCodes(10);
    expect(plaintext.length).toBe(10);
    expect(records.length).toBe(10);

    for (const code of plaintext) {
      // Formatted as xxxx-xxxx
      expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/i);
    }

    const testRecords = records.map((r, i) => ({
      id: `rec-${String(i)}`,
      codeHash: r.codeHash,
      salt: r.salt,
      usedAt: null as Date | null,
    }));

    // Verify first code
    const firstCandidate = plaintext[0] ?? '';
    const check1 = verifyRecoveryCode(firstCandidate, testRecords);
    expect(check1.valid).toBe(true);
    expect(check1.matchedId).toBe('rec-0');

    // Mark as used
    const firstRec = testRecords[0];
    if (firstRec) {
      firstRec.usedAt = new Date();
    }

    // Verify used code cannot be used again
    const checkUsed = verifyRecoveryCode(firstCandidate, testRecords);
    expect(checkUsed.valid).toBe(false);

    // Invalid code is rejected
    const checkInvalid = verifyRecoveryCode('0000-0000', testRecords);
    expect(checkInvalid.valid).toBe(false);

    // Invalid format rejected
    expect(verifyRecoveryCode('invalid-format', testRecords).valid).toBe(false);
  });

  it('covers base32Encode non-multiple of 5 bytes and base32Decode invalid characters', () => {
    // Non-multiple of 5 bytes triggers bits > 0
    const oneByte = Buffer.from([0x61]);
    const encoded = base32Encode(oneByte);
    expect(encoded).toBe('ME');
    const decoded = base32Decode(encoded);
    expect(decoded.equals(oneByte)).toBe(true);

    // Invalid character in base32Decode
    expect(() => base32Decode('INVALID89')).toThrow('Invalid Base32 character');
  });

  it('covers decryptTotpSecret malformed strings and invalid IV / tag lengths', () => {
    expect(() => decryptTotpSecret('malformed')).toThrow('Malformed encrypted TOTP secret.');
    expect(() => decryptTotpSecret('::')).toThrow('Malformed encrypted TOTP secret.');
    expect(() => decryptTotpSecret('a:b:c')).toThrow(
      'Invalid initialization vector or auth tag length.',
    );
  });

  it('covers verifyTotpCode invalid code formats', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '123').valid).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef').valid).toBe(false);
    expect(verifyTotpCode(secret, '').valid).toBe(false);
  });
});
