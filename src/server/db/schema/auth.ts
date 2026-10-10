import { pgTable, uuid, varchar, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';

/**
 * Better-Auth user table
 * Tracks authenticated users with UUIDv7 primary keys and role attribute.
 */
export const user = pgTable('user', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: varchar('role', { length: 32 }).notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Better-Auth session table
 * Server-side session tracking with rotation and instant revocation support.
 */
export const session = pgTable('session', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  lastReauthenticatedAt: timestamp('last_reauthenticated_at', {
    withTimezone: true,
    mode: 'date',
  })
    .notNull()
    .defaultNow(),
});

/**
 * Better-Auth account table
 * Stores credentials (argon2id password hash) and future OAuth providers.
 */
export const account = pgTable('account', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Better-Auth verification table
 * Single-use tokens for email verification, password reset, and MFA challenge tickets.
 */
export const verification = pgTable('verification', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Scoped API keys table (ADR-0006)
 * Programmatic interface for CLI and agentic MCP tooling.
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Rate limit persistence table
 * Database-backed rate limiting surviving application restarts.
 */
export const rateLimits = pgTable('rate_limits', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  key: varchar('key', { length: 255 }).notNull().unique(),
  count: integer('count').notNull().default(1),
  lastAttemptAt: timestamp('last_attempt_at', {
    withTimezone: true,
    mode: 'date',
  })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * TOTP credentials table (TASK-0008)
 * Stores encrypted TOTP shared secrets and replay prevention step counters.
 */
export const totpCredential = pgTable('totp_credential', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  verified: boolean('verified').notNull().default(false),
  lastUsedStep: integer('last_used_step').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Single-use recovery codes table (TASK-0008)
 * 10 backup codes generated at enrolment, stored hashed, invalidated on regenerate.
 */
export const recoveryCode = pgTable('recovery_code', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  salt: varchar('salt', { length: 64 }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Passkeys (WebAuthn credentials) table (TASK-0008)
 * Stores public keys, credential IDs, and sign counters for passwordless MFA.
 */
export const passkeyCredential = pgTable('passkey_credential', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  credentialId: varchar('credential_id', { length: 512 }).notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
export type TotpCredential = typeof totpCredential.$inferSelect;
export type NewTotpCredential = typeof totpCredential.$inferInsert;
export type RecoveryCode = typeof recoveryCode.$inferSelect;
export type NewRecoveryCode = typeof recoveryCode.$inferInsert;
export type PasskeyCredential = typeof passkeyCredential.$inferSelect;
export type NewPasskeyCredential = typeof passkeyCredential.$inferInsert;
