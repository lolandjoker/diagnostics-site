CREATE TABLE "operators" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "operators_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "operator_id" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;