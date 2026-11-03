ALTER TABLE "experts" ADD COLUMN "full_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "edited_at" timestamp with time zone;