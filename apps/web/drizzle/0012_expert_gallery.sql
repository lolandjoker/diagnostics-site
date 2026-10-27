CREATE TABLE "expert_gallery_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"expert_id" integer NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expert_gallery_photos" ADD CONSTRAINT "expert_gallery_photos_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expert_gallery_photos_expert_idx" ON "expert_gallery_photos" USING btree ("expert_id","sort");