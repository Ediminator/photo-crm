import { hash, verify } from '@node-rs/argon2';
import commonPasswordsList from './common-passwords.json';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

// Use Set for O(1) membership lookup
const commonPasswordsSet = new Set<string>(commonPasswordsList.map((p) => p.toLowerCase().trim()));

export type PasswordPolicyErrorCode = 'TOO_SHORT' | 'TOO_LONG' | 'COMMON_PASSWORD';

export interface PasswordValidationResult {
  valid: boolean;
  code?: PasswordPolicyErrorCode;
  message?: string;
}

/**
 * Validates a password against the OWASP ASVS 5.0 L2 policy:
 * - Length: 12 - 1024 characters
 * - No restrictive composition rules (spaces, symbols, emojis accepted)
 * - Bundled offline dictionary check against known breached/common passwords
 */
export function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (typeof password !== 'string') {
    return {
      valid: false,
      code: 'TOO_SHORT',
      message: 'Password must be at least 12 characters long.',
    };
  }

  // Count Unicode code points (handles multi-byte emoji correctly)
  const length = Array.from(password).length;

  if (length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      code: 'TOO_SHORT',
      message: 'Password must be at least 12 characters long.',
    };
  }

  if (length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      code: 'TOO_LONG',
      message: 'Password cannot exceed 1024 characters.',
    };
  }

  const normalized = password.toLowerCase().trim();
  if (commonPasswordsSet.has(normalized)) {
    return {
      valid: false,
      code: 'COMMON_PASSWORD',
      message: 'Password is too common or easily guessed. Please choose a more secure password.',
    };
  }

  return { valid: true };
}

/**
 * OWASP ASVS 5.0 Level 2 Recommended Argon2id Parameters:
 * - memoryCost: 65536 KiB (64 MB)
 * - timeCost: 3 iterations
 * - parallelism: 4 lanes
 * - algorithm: 2 (Argon2id)
 */
export const ARGON2ID_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
  parallelism: 4,
  algorithm: 2,
} as const;

/**
 * Hashes a plaintext password using Argon2id with OWASP parameters.
 */
export async function hashPasswordArgon2id(password: string): Promise<string> {
  return await hash(password, ARGON2ID_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 */
export async function verifyPasswordArgon2id(
  hashString: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(hashString, password);
  } catch {
    return false;
  }
}
