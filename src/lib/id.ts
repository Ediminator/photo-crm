import crypto from 'node:crypto';

/**
 * RFC 9562 compliant UUIDv7 generator.
 *
 * Structure:
 * - 48 bits: Unix timestamp (ms) in big-endian representation
 * - 4 bits: version 7 (0b0111)
 * - 12 bits: pseudo-random data
 * - 2 bits: RFC 4122/9562 variant (0b10)
 * - 62 bits: pseudo-random data
 *
 * Guarantees monotonic time-ordered sortability across distributed nodes
 * and complete absence of PII.
 */
export function generateUuidV7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ts = BigInt(timestampMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7: 0b0111xxxx
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);

  // Variant: 0b10xxxxxx
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validates whether a value matches RFC 9562 UUIDv7 format.
 */
export function isUuidV7(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Extracts the millisecond timestamp embedded in a UUIDv7.
 */
export function extractUuidV7Timestamp(uuid: string): number {
  if (!isUuidV7(uuid)) {
    throw new Error('Invalid UUIDv7 string provided');
  }
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return Number(BigInt(`0x${hex}`));
}
