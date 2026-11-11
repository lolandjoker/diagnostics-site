CREATE TABLE "chat_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"tg_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "kind" text DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "expert_id" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "broadcast_id" integer;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_media_id_chat_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."chat_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;