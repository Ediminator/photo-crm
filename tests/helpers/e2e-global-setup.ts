import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

export const E2E_OWNER_EMAIL = 'owner@example.com';
export const E2E_OWNER_PASSWORD = 'ValidOwnerPassword123!';

export default async function globalSetup() {
  const dbDir = path.resolve('./.pglite-e2e');
  fs.rmSync(dbDir, { recursive: true, force: true });

  const pglite = new PGlite(dbDir);
  await pglite.waitReady;

  const drizzleDir = path.resolve('./drizzle');
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
    await pglite.exec(sql);
  }

  await pglite.close();
}
