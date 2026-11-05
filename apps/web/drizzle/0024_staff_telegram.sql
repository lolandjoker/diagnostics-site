CREATE TABLE "staff_notices" (
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"conversation_id" uuid NOT NULL,
	"staff_link_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_notices_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "staff_telegram" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"staff_id" integer DEFAULT 0 NOT NULL,
	"telegram_user_id" bigint,
	"telegram_name" text DEFAULT '' NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_users" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"forecast" boolean DEFAULT false NOT NULL,
	"forecast_sent_on" date,
	"forecast_asked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_notices" ADD CONSTRAINT "staff_notices_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notices" ADD CONSTRAINT "staff_notices_staff_link_id_staff_telegram_id_fk" FOREIGN KEY ("staff_link_id") REFERENCES "public"."staff_telegram"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_telegram_staff_idx" ON "staff_telegram" USING btree ("kind","staff_id");--> statement-breakpoint
CREATE INDEX "staff_telegram_user_idx" ON "staff_telegram" USING btree ("telegram_user_id");