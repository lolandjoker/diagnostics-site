ALTER TABLE "broadcasts" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "registered_hours" integer;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "silent_hours" integer;