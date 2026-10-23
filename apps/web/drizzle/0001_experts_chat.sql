CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"expert_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expert_read_at" timestamp with time zone,
	CONSTRAINT "conversations_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "expert_photos" (
	"expert_id" integer PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experts_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author" text NOT NULL,
	"expert_id" integer,
	"body" text DEFAULT '' NOT NULL,
	"product_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variation_texts" (
	"variation_id" integer NOT NULL,
	"value" integer NOT NULL,
	"short_text" text DEFAULT '' NOT NULL,
	"full_text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variation_texts_variation_id_value_pk" PRIMARY KEY("variation_id","value")
);
--> statement-breakpoint
CREATE TABLE "variations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"method" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "variation_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "show_on_result" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_photos" ADD CONSTRAINT "expert_photos_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_texts" ADD CONSTRAINT "variation_texts_variation_id_variations_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."variations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_variation_id_variations_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."variations"("id") ON DELETE set null ON UPDATE no action;