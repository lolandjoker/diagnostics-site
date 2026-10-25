CREATE TABLE "call_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" uuid NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"sdp" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"caller" text NOT NULL,
	"expert_id" integer,
	"status" text DEFAULT 'ringing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"client_seen_at" timestamp with time zone,
	"staff_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "call_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_signals" ADD CONSTRAINT "call_signals_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_signals_call_idx" ON "call_signals" USING btree ("call_id","id");--> statement-breakpoint
CREATE INDEX "calls_conversation_idx" ON "calls" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_one_open_idx" ON "calls" USING btree ("conversation_id") WHERE "calls"."status" in ('ringing', 'active');