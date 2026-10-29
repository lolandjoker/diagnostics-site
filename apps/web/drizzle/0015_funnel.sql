CREATE TABLE "funnel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"lead_id" uuid,
	"step" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_visitor_step_idx" ON "funnel_events" USING btree ("visitor_id","step") WHERE "funnel_events"."lead_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_lead_step_idx" ON "funnel_events" USING btree ("lead_id","step") WHERE "funnel_events"."lead_id" is not null;--> statement-breakpoint
CREATE INDEX "funnel_events_step_created_idx" ON "funnel_events" USING btree ("step","created_at");