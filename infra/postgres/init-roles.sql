-- ==============================================================================
-- PostgreSQL Least-Privilege Role Initialization (Reference SQL)
--
-- Roles:
--  1. photo_crm_migrator: Owns schema public, has DDL rights (CREATE, ALTER, DROP)
--  2. photo_crm_app: Runtime application role, has DML rights only (SELECT, INSERT,
--     UPDATE, DELETE). Explicitly denied DDL / CREATE TABLE in public schema.
-- ==============================================================================

-- 1. Create migration role with LOGIN (no superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'photo_crm_migrator') THEN
    CREATE ROLE photo_crm_migrator WITH LOGIN PASSWORD 'changeme_migrator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2. Create application role with LOGIN (no superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'photo_crm_app') THEN
    CREATE ROLE photo_crm_app WITH LOGIN PASSWORD 'changeme_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 3. Grant connection privileges to the database
GRANT CONNECT ON DATABASE photo_crm_dev TO photo_crm_migrator;
GRANT CONNECT ON DATABASE photo_crm_dev TO photo_crm_app;

-- 4. Assign schema ownership & DDL privileges to migration role
GRANT USAGE, CREATE ON SCHEMA public TO photo_crm_migrator;
ALTER SCHEMA public OWNER TO photo_crm_migrator;

-- 5. Revoke DDL creation rights on public schema from PUBLIC and application role
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM photo_crm_app;

-- 6. Grant schema USAGE (resolution of objects) to application role
GRANT USAGE ON SCHEMA public TO photo_crm_app;

-- 7. Grant DML rights on existing tables and sequences in public schema
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO photo_crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO photo_crm_app;

-- 8. Configure default privileges for future objects created by migration role
ALTER DEFAULT PRIVILEGES FOR ROLE photo_crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO photo_crm_app;

ALTER DEFAULT PRIVILEGES FOR ROLE photo_crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO photo_crm_app;

-- 9. Enforce append-only permissions on audit_events table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'audit_events') THEN
    REVOKE UPDATE, DELETE ON audit_events FROM photo_crm_app;
    GRANT SELECT, INSERT ON audit_events TO photo_crm_app;
  END IF;
END
$$;
