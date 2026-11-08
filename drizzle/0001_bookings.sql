CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"google_event_id" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_google_event_id_unique" UNIQUE("google_event_id"),
	CONSTRAINT "booking_end_after_start" CHECK ("bookings"."end_at">"bookings"."start_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_start_at_unique" ON "bookings" USING btree ("start_at");