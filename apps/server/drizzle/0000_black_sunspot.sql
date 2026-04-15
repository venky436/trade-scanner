CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_agent" varchar(500),
	"ip_address" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "signal_accuracy_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"signal_type" varchar(20) NOT NULL,
	"action" varchar(10) NOT NULL,
	"signal_score" integer NOT NULL,
	"entry_price" numeric(12, 2) NOT NULL,
	"entry_time" timestamp NOT NULL,
	"target_price" numeric(12, 2) NOT NULL,
	"stop_loss" numeric(12, 2) NOT NULL,
	"evaluation_time" timestamp NOT NULL,
	"max_price" numeric(12, 2),
	"min_price" numeric(12, 2),
	"final_price" numeric(12, 2),
	"target_hit_time" timestamp,
	"stop_hit_time" timestamp,
	"result" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(100),
	"role" varchar(10) DEFAULT 'USER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;