import "dotenv/config";
import { db } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { hashPassword } from "../utils/hash.js";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@tradescanner.io";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

async function seed() {
  console.log(`Seeding admin user: ${ADMIN_EMAIL}`);

  const existing = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (existing.length > 0) {
    console.log("Admin user already exists. Skipping.");
    process.exit(0);
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  await db.insert(users).values({
    email: ADMIN_EMAIL,
    passwordHash,
    name: "Admin",
    role: "ADMIN",
  });

  console.log(`Admin user created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
