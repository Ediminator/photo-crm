import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-5: PostgreSQL least-privilege role boundaries', () => {
  const shScriptPath = path.resolve(import.meta.dirname, '../../infra/postgres/init-roles.sh');
  const sqlScriptPath = path.resolve(import.meta.dirname, '../../infra/postgres/init-roles.sql');

  it('AC-5: init-roles.sh and init-roles.sql exist and are readable', () => {
    expect(fs.existsSync(shScriptPath)).toBe(true);
    expect(fs.existsSync(sqlScriptPath)).toBe(true);
  });

  it('AC-5: role initialization creates ownlight_migrator with DDL rights and no superuser', () => {
    const shContent = fs.readFileSync(shScriptPath, 'utf8');
    const sqlContent = fs.readFileSync(sqlScriptPath, 'utf8');

    // Shell script creates migrator role with non-superuser attributes
    expect(shContent).toContain('${POSTGRES_MIGRATOR_USER}');
    expect(shContent).toMatch(/CREATE ROLE "\$\{POSTGRES_MIGRATOR_USER\}" WITH LOGIN/);
    expect(shContent).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE');

    // Migrator owns schema public and has CREATE + USAGE
    expect(shContent).toContain(
      'GRANT USAGE, CREATE ON SCHEMA public TO "${POSTGRES_MIGRATOR_USER}"',
    );
    expect(shContent).toContain('ALTER SCHEMA public OWNER TO "${POSTGRES_MIGRATOR_USER}"');

    // Reference SQL verifies the same
    expect(sqlContent).toContain('ownlight_migrator');
    expect(sqlContent).toMatch(/CREATE ROLE ownlight_migrator WITH LOGIN/);
    expect(sqlContent).toContain('GRANT USAGE, CREATE ON SCHEMA public TO ownlight_migrator');
    expect(sqlContent).toContain('ALTER SCHEMA public OWNER TO ownlight_migrator');
  });

  it('AC-5: role initialization explicitly revokes CREATE on schema public from application role and PUBLIC', () => {
    const shContent = fs.readFileSync(shScriptPath, 'utf8');
    const sqlContent = fs.readFileSync(sqlScriptPath, 'utf8');

    // Revoke CREATE from PUBLIC
    expect(shContent).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
    expect(sqlContent).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');

    // Explicitly revoke CREATE from application role
    expect(shContent).toContain('REVOKE CREATE ON SCHEMA public FROM "${POSTGRES_APP_USER}";');
    expect(sqlContent).toContain('REVOKE CREATE ON SCHEMA public FROM ownlight_app;');
  });

  it('AC-5: role initialization grants application role USAGE and default DML privileges', () => {
    const shContent = fs.readFileSync(shScriptPath, 'utf8');
    const sqlContent = fs.readFileSync(sqlScriptPath, 'utf8');

    // USAGE granted on schema public
    expect(shContent).toContain('GRANT USAGE ON SCHEMA public TO "${POSTGRES_APP_USER}";');
    expect(sqlContent).toContain('GRANT USAGE ON SCHEMA public TO ownlight_app;');

    // Default privileges: SELECT, INSERT, UPDATE, DELETE on tables
    expect(shContent).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE "\$\{POSTGRES_MIGRATOR_USER\}" IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "\$\{POSTGRES_APP_USER\}";/,
    );
    expect(sqlContent).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE ownlight_migrator IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ownlight_app;/,
    );

    // Default privileges: USAGE, SELECT on sequences
    expect(shContent).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE "\$\{POSTGRES_MIGRATOR_USER\}" IN SCHEMA public\s+GRANT USAGE, SELECT ON SEQUENCES TO "\$\{POSTGRES_APP_USER\}";/,
    );
    expect(sqlContent).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE ownlight_migrator IN SCHEMA public\s+GRANT USAGE, SELECT ON SEQUENCES TO ownlight_app;/,
    );
  });

  it('AC-5: application role is never granted SUPERUSER, CREATEDB, or CREATEROLE', () => {
    const shContent = fs.readFileSync(shScriptPath, 'utf8');
    const sqlContent = fs.readFileSync(sqlScriptPath, 'utf8');

    for (const content of [shContent, sqlContent]) {
      // Must not contain SUPERUSER without NO prefix for app role
      expect(content).not.toMatch(/CREATE ROLE [^\n]*app[^\n]*\bSUPERUSER\b/i);
      expect(content).not.toMatch(/ALTER ROLE [^\n]*app[^\n]*\bSUPERUSER\b/i);

      // Must explicitly declare NOSUPERUSER
      expect(content).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    }
  });
});
