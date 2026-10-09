import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.MIGRATION_DATABASE_URL ||
      process.env.DATABASE_MIGRATOR_URL ||
      process.env.DATABASE_URL ||
      'postgres://photo_crm_migrator:password@127.0.0.1:5432/photo_crm_dev',
  },
  strict: true,
  verbose: true,
});
