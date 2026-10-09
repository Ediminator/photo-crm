CREATE TABLE "studio_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"studio_name" varchar(255) NOT NULL,
	"default_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
