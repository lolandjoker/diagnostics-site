ALTER TABLE "reviews" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "reviews_shown" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Число отзывов на карточке уже заведённых экспертов: случайное от 200 до 500 (дальше меняется в админке)
UPDATE "experts" SET "reviews_shown" = 200 + floor(random() * 301)::int;