ALTER TABLE "leads" ADD COLUMN "telegram_user_id" bigint;--> statement-breakpoint
CREATE INDEX "leads_telegram_user_idx" ON "leads" USING btree ("telegram_user_id","created_at");