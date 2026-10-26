CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"expert_id" integer NOT NULL,
	"author_name" text NOT NULL,
	"stars" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "rating" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_expert_idx" ON "reviews" USING btree ("expert_id","created_at");--> statement-breakpoint
-- Рейтинг уже заведённых экспертов: от 4,6 до 4,9 (дальше меняется в админке)
UPDATE "experts" SET "rating" = 46 + ("id" % 4);