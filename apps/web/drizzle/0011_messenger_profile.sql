CREATE TABLE "expert_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"expert_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_lead_id_unique";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "client_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "about" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "tags" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_certificates" ADD CONSTRAINT "expert_certificates_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expert_certificates_expert_idx" ON "expert_certificates" USING btree ("expert_id","sort");--> statement-breakpoint
CREATE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_lead_expert_idx" ON "conversations" USING btree ("lead_id","expert_id");--> statement-breakpoint
-- Уже идущие чаты клиент видел — иначе в его новом списке чатов всё стало бы «непрочитанным»
UPDATE "conversations" SET "client_read_at" = "last_message_at";