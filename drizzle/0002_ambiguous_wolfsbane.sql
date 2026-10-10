CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" text,
	"action" varchar(128) NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" varchar(32) NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "audit_events_actor_type_check" CHECK (actor_type IN ('owner', 'client', 'system', 'agent', 'token')),
	CONSTRAINT "audit_events_outcome_check" CHECK (outcome IN ('success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_type_idx" ON "audit_events" USING btree ("actor_type");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_audit_events()
RETURNS TRIGGER AS $$
BEGIN
  IF CURRENT_USER IN ('photo_crm_app', 'ownlight_app') OR SESSION_USER IN ('photo_crm_app', 'ownlight_app') THEN
    RAISE EXCEPTION 'audit_events is append-only for application role %', CURRENT_USER;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_events rows cannot be updated';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_append_only ON "audit_events";--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION protect_audit_events();--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'photo_crm_app') THEN
    REVOKE UPDATE, DELETE ON "audit_events" FROM "photo_crm_app";
    GRANT SELECT, INSERT ON "audit_events" TO "photo_crm_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_app') THEN
    REVOKE UPDATE, DELETE ON "audit_events" FROM "ownlight_app";
    GRANT SELECT, INSERT ON "audit_events" TO "ownlight_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'photo_crm_migrator') THEN
    GRANT ALL ON "audit_events" TO "photo_crm_migrator";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_migrator') THEN
    GRANT ALL ON "audit_events" TO "ownlight_migrator";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'photo_crm_retention') THEN
    GRANT SELECT, DELETE ON "audit_events" TO "photo_crm_retention";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_retention') THEN
    GRANT SELECT, DELETE ON "audit_events" TO "ownlight_retention";
  END IF;
END
$$;