ALTER TABLE "leads" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_full_text_sent_at" timestamp with time zone;