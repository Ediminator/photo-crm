import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { apiKeys, type ApiKey } from '@/server/db/schema/auth';

export const API_KEY_PREFIX = 'pcrm_live_';

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  scopes: string[];
  expiresInDays?: number;
  expiresAt?: Date | null;
  client?: DbClient;
}

export interface CreatedApiKeyResult {
  apiKey: string;
  record: ApiKey;
}

export interface ApiKeyWithScopes extends Omit<ApiKey, 'scopes'> {
  scopes: string[];
}

export interface VerifyApiKeyResult {
  valid: boolean;
  key?: ApiKeyWithScopes;
  error?: 'not_found' | 'expired' | 'revoked' | 'invalid_format';
}

/**
 * Computes the SHA-256 hash of a high-entropy bearer token for database storage and indexing.
 * Bearer tokens contain 256 bits of CSPRNG entropy; fast cryptographic hashing (SHA-256)
 * is standard practice to allow indexed lookups while protecting tokens at rest.
 */
export function hashApiKeyToken(tokenString: string): string {
  // codeql[js/insufficient-password-hash] High-entropy bearer token hashed with SHA-256 for fast indexed database lookup, not a human password.
  return crypto.createHash('sha256').update(tokenString).digest('hex');
}

/**
 * Generates a cryptographically secure, scoped API token in format pcrm_live_<32_bytes_hex>.
 * The raw token is returned once and NEVER stored unhashed.
 */
export async function createApiKey({
  userId,
  name,
  scopes,
  expiresInDays,
  expiresAt: explicitExpiresAt,
  client = defaultDb,
}: CreateApiKeyInput): Promise<CreatedApiKeyResult> {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const apiKey = `${API_KEY_PREFIX}${randomHex}`;
  const prefix = apiKey.slice(0, 16);
  const tokenHash = hashApiKeyToken(apiKey);

  const now = new Date();
  let expiresAt: Date | null = null;

  if (explicitExpiresAt !== undefined) {
    expiresAt = explicitExpiresAt;
  } else if (expiresInDays !== undefined) {
    expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  const [record] = await client
    .insert(apiKeys)
    .values({
      userId,
      name,
      prefix,
      tokenHash,
      scopes: JSON.stringify(scopes),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!record) {
    throw new Error('Failed to create API key');
  }

  return { apiKey, record };
}

/**
 * Validates a Bearer API token against stored SHA-256 hash.
 * Checks revocation and expiration status.
 */
export async function verifyApiKey(
  apiKey: string,
  client: DbClient = defaultDb,
): Promise<VerifyApiKeyResult> {
  if (typeof apiKey !== 'string' || !apiKey.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: 'invalid_format' };
  }

  const tokenHash = hashApiKeyToken(apiKey);
  const now = new Date();

  const rows = await client.select().from(apiKeys).where(eq(apiKeys.tokenHash, tokenHash)).limit(1);

  const record = rows[0];
  if (!record) {
    return { valid: false, error: 'not_found' };
  }

  if (record.revokedAt !== null) {
    return { valid: false, error: 'revoked' };
  }

  if (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, error: 'expired' };
  }

  // Update last_used_at timestamp
  await client
    .update(apiKeys)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(apiKeys.id, record.id));

  let parsedScopes: string[] = [];
  try {
    parsedScopes = JSON.parse(record.scopes) as string[];
  } catch {
    parsedScopes = [];
  }

  return {
    valid: true,
    key: {
      id: record.id,
      userId: record.userId,
      name: record.name,
      prefix: record.prefix,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      scopes: parsedScopes,
    },
  };
}

/**
 * Revokes an API key immediately.
 */
export async function revokeApiKey(keyId: string, client: DbClient = defaultDb): Promise<void> {
  const now = new Date();
  await client.update(apiKeys).set({ revokedAt: now, updatedAt: now }).where(eq(apiKeys.id, keyId));
}

/**
 * Checks whether the granted scopes satisfy all required scopes.
 */
export function hasRequiredScopes(
  grantedScopes: string[],
  requiredScopes?: readonly string[],
): boolean {
  if (!requiredScopes || requiredScopes.length === 0) {
    return true;
  }

  // Wildcard scope allows everything
  if (grantedScopes.includes('*')) {
    return true;
  }

  const grantedSet = new Set(grantedScopes);
  return requiredScopes.every((scope) => grantedSet.has(scope));
}
