import crypto from 'node:crypto';
import { renderSVG } from 'uqr';
import { env } from '@/env';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a buffer to RFC 4648 Base32 string (unpadded).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      const char = BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      if (char) output += char;
      bits -= 5;
    }
  }

  if (bits > 0) {
    const char = BASE32_ALPHABET[(value << (5 - bits)) & 31];
    if (char) output += char;
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Derives a 32-byte AES-256-GCM encryption key from AUTH_SECRET using HKDF-SHA256.
 * Refuses to encrypt or decrypt if AUTH_SECRET is not configured or fails entropy checks (I1-S04).
 */
export function getTotpEncryptionKey(): Buffer {
  let secret: string | undefined;
  try {
    secret = process.env.AUTH_SECRET ?? env.AUTH_SECRET;
  } catch {
    secret = process.env.AUTH_SECRET;
  }

  if (!secret || typeof secret !== 'string' || secret.trim().length === 0 || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is required and must be at least 32 characters to derive TOTP encryption key.',
    );
  }

  return Buffer.from(crypto.hkdfSync('sha256', secret, '', 'totp-secret-encryption-v1', 32));
}

/**
 * Generates a cryptographically random 20-byte Base32 secret (160 bits) for TOTP enrolment.
 */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/**
 * Encrypts a TOTP secret at rest using AES-256-GCM.
 * Output format: `ivHex:authTagHex:ciphertextHex`.
 */
export function encryptTotpSecret(secret: string): string {
  const key = getTotpEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit standard IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted TOTP secret.
 * Throws if authentication tag or ciphertext has been tampered with.
 */
export function decryptTotpSecret(encryptedString: string): string {
  const parts = encryptedString.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed encrypted TOTP secret.');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');
  const key = getTotpEncryptionKey();

  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid initialization vector or auth tag length.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generates standard RFC 6238 otpauth URI for authenticator apps.
 */
export function getOtpauthUri(secret: string, accountName: string, issuer = 'Setline'): string {
  const encIssuer = encodeURIComponent(issuer);
  const encAccount = encodeURIComponent(accountName);
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${secret}&issuer=${encIssuer}&digits=6&period=30`;
}

/**
 * Renders self-hosted pure vector SVG QR code (zero third-party requests).
 */
export function generateTotpQrSvg(otpauthUri: string): string {
  return renderSVG(otpauthUri);
}

/**
 * Calculates a 6-digit TOTP code for a given Base32 secret and 30-second time-step.
 */
export function generateTotpCode(secret: string, step?: number): string {
  const targetStep = step ?? Math.floor(Date.now() / 30000);
  const key = base32Decode(secret);

  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(targetStep));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = (hmac.at(-1) ?? 0) & 0x0f;
  const codeInt = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;

  return codeInt.toString().padStart(6, '0');
}

/**
 * Verifies a submitted TOTP code against a secret with ±1 time-step (30s) tolerance.
 * Enforces replay prevention: rejects any code if its matching time-step is <= lastUsedStep.
 */
export function verifyTotpCode(
  secret: string,
  candidateCode: string,
  lastUsedStep = 0,
): { valid: boolean; step?: number } {
  const cleanCode = candidateCode.trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { valid: false };
  }

  const nowStep = Math.floor(Date.now() / 30000);
  // Check windows: current step, prior step (-30s), next step (+30s)
  const stepsToCheck = [nowStep, nowStep - 1, nowStep + 1];

  for (const step of stepsToCheck) {
    // Replay check: the step must be strictly greater than lastUsedStep
    if (step <= lastUsedStep) {
      continue;
    }

    try {
      const expected = generateTotpCode(secret, step);
      const isMatch = crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expected));
      if (isMatch) {
        return { valid: true, step };
      }
    } catch {
      // Continue checking next window
    }
  }

  return { valid: false };
}

/**
 * Generates 10 cryptographically secure recovery codes formatted as `xxxx-xxxx`.
 * Stored hashed using scryptSync with high entropy salt.
 */
export function generateRecoveryCodes(count = 10): {
  plaintext: string[];
  records: { codeHash: string; salt: string }[];
} {
  const plaintext: string[] = [];
  const records: { codeHash: string; salt: string }[] = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(2).toString('hex') + '-' + crypto.randomBytes(2).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const codeHash = crypto.scryptSync(raw.toLowerCase().trim(), salt, 32).toString('hex');

    plaintext.push(raw);
    records.push({ codeHash, salt });
  }

  return { plaintext, records };
}

/**
 * Verifies a single-use recovery code against unused database records.
 */
export function verifyRecoveryCode(
  candidateCode: string,
  records: { id: string; codeHash: string; salt: string; usedAt: Date | null }[],
): { valid: boolean; matchedId?: string } {
  const clean = candidateCode.trim().toLowerCase();
  if (!/^[0-9a-f]{4}-[0-9a-f]{4}$/i.test(clean)) {
    return { valid: false };
  }

  for (const record of records) {
    if (record.usedAt !== null) {
      continue; // Single-use: already consumed
    }

    try {
      const candidateHash = crypto.scryptSync(clean, record.salt, 32).toString('hex');

      const isMatch = crypto.timingSafeEqual(
        Buffer.from(candidateHash),
        Buffer.from(record.codeHash),
      );

      if (isMatch) {
        return { valid: true, matchedId: record.id };
      }
    } catch {
      // Continue
    }
  }

  return { valid: false };
}
