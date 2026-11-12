ALTER TABLE "broadcasts" ADD COLUMN "channels" text DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "subject" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "email_skip_telegram" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "email_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "email_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "email_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");