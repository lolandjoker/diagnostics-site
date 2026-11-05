CREATE TABLE "daily_cards" (
	"lead_id" uuid NOT NULL,
	"day" date NOT NULL,
	"position" integer NOT NULL,
	"card" integer NOT NULL,
	"text" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_cards_lead_id_day_pk" PRIMARY KEY("lead_id","day")
);
--> statement-breakpoint
ALTER TABLE "daily_cards" ADD CONSTRAINT "daily_cards_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;