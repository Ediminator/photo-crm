CREATE TABLE "client_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"line1" varchar(200) NOT NULL,
	"line2" varchar(200),
	"postal_code" varchar(20) NOT NULL,
	"city" varchar(100) NOT NULL,
	"region" varchar(100),
	"country_code" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_addresses_client_id_type_unique" UNIQUE("client_id","type"),
	CONSTRAINT "client_addresses_type_check" CHECK (type IN ('postal', 'billing'))
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"given_name" varchar(100),
	"family_name" varchar(100),
	"email" varchar(254),
	"email_normalized" varchar(254),
	"phone" varchar(32),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_name_check" CHECK ((given_name IS NOT NULL AND length(trim(given_name)) > 0) OR (family_name IS NOT NULL AND length(trim(family_name)) > 0))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(20) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"preferred_locale" varchar(10) NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_kind_check" CHECK (kind IN ('person', 'company')),
	CONSTRAINT "clients_preferred_locale_check" CHECK (preferred_locale IN ('en', 'de'))
);
--> statement-breakpoint
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_addresses_client_id_idx" ON "client_addresses" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_email_normalized_idx" ON "client_contacts" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "client_contacts_client_id_primary_idx" ON "client_contacts" USING btree ("client_id") WHERE is_primary = true;