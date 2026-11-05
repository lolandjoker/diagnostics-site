CREATE TABLE "telegram_messages" (
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"conversation_id" uuid NOT NULL,
	"site_message_id" integer,
	"expert_id" integer,
	"with_buttons" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_messages_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "via_telegram" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_site_message_id_messages_id_fk" FOREIGN KEY ("site_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_messages_chat_idx" ON "telegram_messages" USING btree ("chat_id","created_at");