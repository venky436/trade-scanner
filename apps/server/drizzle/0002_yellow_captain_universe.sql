CREATE TABLE "signal_tracking_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"window_minutes" integer NOT NULL,
	"status" varchar(10) DEFAULT 'PENDING' NOT NULL,
	"price_after" numeric(12, 2),
	"change_percent" numeric(8, 4),
	"change_points" numeric(12, 2),
	"max_price" numeric(12, 2),
	"min_price" numeric(12, 2),
	"max_profit_percent" numeric(8, 4),
	"max_drawdown_percent" numeric(8, 4),
	"evaluated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_tracking_windows" ADD CONSTRAINT "signal_tracking_windows_signal_id_signal_tracking_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal_tracking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stw_signal" ON "signal_tracking_windows" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "idx_stw_pending" ON "signal_tracking_windows" USING btree ("status");
