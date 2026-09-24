CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_cursors" (
	"competitor_id" text PRIMARY KEY NOT NULL,
	"next_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"competitor_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"tagline" text NOT NULL,
	"price" text NOT NULL,
	"description" text NOT NULL,
	"changed" boolean NOT NULL,
	"summary" text,
	"summary_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_cursors" ADD CONSTRAINT "listing_cursors_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_competitor_id_idx" ON "snapshots" USING btree ("competitor_id","id" DESC NULLS LAST);