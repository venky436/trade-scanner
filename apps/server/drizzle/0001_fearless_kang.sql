CREATE TABLE "signal_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"signal_time" timestamp NOT NULL,
	"price_at_signal" numeric(12, 2) NOT NULL,
	"outlook" varchar(30) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"confidence_bucket" varchar(15) NOT NULL,
	"zone" varchar(20) NOT NULL,
	"bias" varchar(10) NOT NULL,
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
CREATE TABLE "watch_zone" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"added_price" numeric(12, 2) NOT NULL,
	"signal_action" varchar(10) NOT NULL,
	"signal_type" varchar(20),
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_zone" ADD CONSTRAINT "watch_zone_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;