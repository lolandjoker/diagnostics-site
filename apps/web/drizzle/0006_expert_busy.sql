ALTER TABLE "experts" ADD COLUMN "busy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- «В сети» теперь держится, пока не выключат (раньше гасло через 5 минут без панели).
-- Тем, у кого статус уже погас по старому правилу, снимаем флаг — после выката у всех тот же статус, что и до него.
UPDATE "experts" SET "online" = false WHERE "online" AND ("last_seen_at" IS NULL OR "last_seen_at" < now() - interval '5 minutes');