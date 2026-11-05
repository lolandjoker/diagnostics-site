CREATE TABLE "club_quizzes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"input" text NOT NULL,
	"result" text NOT NULL,
	"model" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_quizzes" ADD CONSTRAINT "club_quizzes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_quizzes_lead_idx" ON "club_quizzes" USING btree ("lead_id","kind","created_at");