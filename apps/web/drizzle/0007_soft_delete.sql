ALTER TABLE "experts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "deleted_at" timestamp with time zone;