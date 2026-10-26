CREATE TABLE "expert_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"from_expert_id" integer NOT NULL,
	"to_expert_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expert_change_requests" ADD CONSTRAINT "expert_change_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_change_requests" ADD CONSTRAINT "expert_change_requests_from_expert_id_experts_id_fk" FOREIGN KEY ("from_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_change_requests" ADD CONSTRAINT "expert_change_requests_to_expert_id_experts_id_fk" FOREIGN KEY ("to_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expert_change_conversation_idx" ON "expert_change_requests" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expert_change_one_pending_idx" ON "expert_change_requests" USING btree ("conversation_id") WHERE "expert_change_requests"."status" = 'pending';