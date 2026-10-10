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
      'postgres://setline_migrator:password@127.0.0.1:5432/setline_dev',
  },
  strict: true,
  verbose: true,
});
