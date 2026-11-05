ALTER TABLE "conversations" ADD COLUMN "greeting_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Чатам, начатым до приветствий, оно уже не нужно
UPDATE "conversations" SET "greeting_sent_at" = "created_at" WHERE "created_at" < now() - interval '17 seconds';
