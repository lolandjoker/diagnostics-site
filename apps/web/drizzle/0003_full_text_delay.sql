ALTER TABLE "conversations" ADD COLUMN "full_text_sent_at" timestamp with time zone;--> statement-breakpoint
-- Чатам, начатым до этой версии, текст 2 уже пришёл сразу — второй раз не отправляем
UPDATE "conversations" SET "full_text_sent_at" = "created_at";