#!/usr/bin/env node
/**
 * scripts/seed-demo.mjs
 * Seeds deterministic synthetic demo data for development and testing.
 *
 * Safety guards:
 * 1. Strictly refuses to execute in production unless --force-demo is explicitly passed.
 * 2. Uses fixed-seed faker to guarantee identical, reproducible data.
 * 3. Enforces RFC 2606 safe domains (@example.com, @example.org) for ALL emails.
 * 4. Fake, non-routable phone numbers only.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faker } from '@faker-js/faker';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

export const SAFE_EMAIL_DOMAINS = ['example.com', 'example.org'];
export const DEFAULT_SEED = 42;

export const studioSettings = pgTable('studio_settings', {
  id: uuid('id').primaryKey(),
  studio_name: varchar('studio_name', { length: 255 }).notNull(),
  default_locale: varchar('default_locale', { length: 10 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Generates an RFC 9562 UUIDv7 deterministically using the provided faker PRNG.
 * @param {any} fakerInstance
 * @param {number} timestampMs
 * @returns {string}
 */
export function generateDeterministicUuidV7(fakerInstance, timestampMs) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = fakerInstance.number.int({ min: 0, max: 255 });
  }

  const ts = BigInt(timestampMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validates that an email address belongs exclusively to safe reserved domains.
 * @param {string} email
 * @returns {boolean}
 */
export function isSafeEmail(email) {
  if (typeof email !== 'string') return false;
  return SAFE_EMAIL_DOMAINS.some((domain) => email.endsWith(`@${domain}`));
}

/**
 * Generates synthetic demo dataset deterministically.
 * @param {number} [seed=DEFAULT_SEED]
 */
export function generateDemoData(seed = DEFAULT_SEED) {
  faker.seed(seed);

  // Fixed anchor timestamp for deterministic created_at/updated_at dates
  const baseTimestampMs = 1770000000000;

  const settings = {
    id: generateDeterministicUuidV7(faker, baseTimestampMs),
    studio_name: 'Lumière Photo & Film Studio',
    default_locale: 'en',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    created_at: new Date(baseTimestampMs),
    updated_at: new Date(baseTimestampMs),
  };

  // Generate synthetic contacts/leads with strictly safe emails and fake numbers
  const contacts = Array.from({ length: 5 }, (_, idx) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const domain = SAFE_EMAIL_DOMAINS[idx % SAFE_EMAIL_DOMAINS.length];
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;
    const phone = `+49 30 000000${String(idx).padStart(2, '0')}`;
    const contactTimestampMs = baseTimestampMs + (idx + 1) * 3600000;

    return {
      id: generateDeterministicUuidV7(faker, contactTimestampMs),
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      created_at: new Date(contactTimestampMs),
    };
  });

  return {
    settings,
    contacts,
  };
}

/**
 * Executes demo seeding into target database with production guards.
 * @param {{
 *   dbClient?: any,
 *   connectionUrl?: string,
 *   seed?: number,
 *   forceDemo?: boolean,
 *   nodeEnv?: string
 * }} [options={}]
 * @returns {Promise<{ success: boolean, data: ReturnType<typeof generateDemoData> }>}
 */
export async function seedDemo(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const forceDemo = options.forceDemo ?? process.argv.includes('--force-demo');

  // Guard against production execution
  if (nodeEnv === 'production' && !forceDemo) {
    throw new Error(
      'FATAL: db:seed:demo refused to run in production environment without explicit --force-demo flag.',
    );
  }

  const seed = options.seed ?? DEFAULT_SEED;
  const demoData = generateDemoData(seed);

  // Validate email safety upfront
  for (const contact of demoData.contacts) {
    if (!isSafeEmail(contact.email)) {
      throw new Error(`Unsafe synthetic email domain detected: "${contact.email}"`);
    }
  }

  let client = options.dbClient;
  let rawClient = null;

  if (!client) {
    const url =
      options.connectionUrl ||
      process.env.DATABASE_URL ||
      'postgres://setline_app:password@127.0.0.1:5432/setline_dev';
    rawClient = postgres(url, { max: 1, onnotice: () => {} });
    client = drizzle(rawClient);
  }

  try {
    // Upsert studio settings
    const existing = await client.select().from(studioSettings).limit(1);
    if (existing.length > 0) {
      await client
        .update(studioSettings)
        .set({
          studio_name: demoData.settings.studio_name,
          default_locale: demoData.settings.default_locale,
          timezone: demoData.settings.timezone,
          currency: demoData.settings.currency,
          updated_at: demoData.settings.updated_at,
        })
        .where(eq(studioSettings.id, existing[0].id));
    } else {
      await client.insert(studioSettings).values(demoData.settings);
    }

    return {
      success: true,
      data: demoData,
    };
  } finally {
    if (rawClient) {
      await rawClient.end();
    }
  }
}

// CLI entry point
const isCli =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isCli) {
  try {
    const result = await seedDemo();
    console.log('✅ Synthetic demo seed completed successfully:');
    console.log(`  Studio: "${result.data.settings.studio_name}"`);
    console.log(`  Safe synthetic contacts generated: ${result.data.contacts.length}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Demo seed failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
