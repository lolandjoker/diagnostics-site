CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"button_text" text DEFAULT '' NOT NULL,
	"button_url" text DEFAULT '' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_starts" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "reminder_for_message_id" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "review_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD COLUMN "purpose" text;--> statement-breakpoint
-- Уже идущим чатам бот не пишет разом: напоминания и просьбы оценить — для новых сообщений и разборов
UPDATE "conversations" SET "review_asked_at" = now() WHERE "full_text_sent_at" IS NOT NULL;--> statement-breakpoint
UPDATE "conversations" c SET "reminder_for_message_id" = (SELECT max(m."id") FROM "messages" m WHERE m."conversation_id" = c."id");
