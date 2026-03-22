import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/users.js";
import { refreshTokens } from "../../db/schema/refresh-tokens.js";
import { hashPassword, comparePassword, hashToken, compareToken } from "../../utils/hash.js";
import { signAccessToken, generateRefreshToken, getRefreshTokenExpiry, type JwtPayload } from "../../utils/jwt.js";

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function registerUser(input: RegisterInput) {
  const { email, password, name } = input;

  // Check if user exists
  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    throw new Error("Email already registered");
  }

  // Validate password
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash,
    name: name ?? null,
    role: "USER",
  }).returning({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
  });

  console.log(`[Auth] User registered: ${user.email}`);
  return user;
}

export async function loginUser(input: LoginInput, userAgent?: string, ipAddress?: string) {
  const { email, password } = input;

  // Find user
  const [user] = await db.select().from(users)
    .where(and(eq(users.email, email.toLowerCase()), eq(users.isActive, true)))
    .limit(1);

  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Verify password
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  // Generate tokens
  const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  // Store refresh token
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
    userAgent: userAgent ?? null,
    ipAddress: ipAddress ?? null,
  });

  console.log(`[Auth] User logged in: ${user.email}`);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function refreshAccessToken(oldRefreshToken: string) {
  // Find all valid (non-expired) refresh tokens
  const tokens = await db.select().from(refreshTokens)
    .where(gt(refreshTokens.expiresAt, new Date()));

  // Find matching token
  const matched = tokens.find((t) => compareToken(oldRefreshToken, t.tokenHash));
  if (!matched) {
    throw new Error("Invalid or expired refresh token");
  }

  // Get user
  const [user] = await db.select().from(users).where(eq(users.id, matched.userId)).limit(1);
  if (!user || !user.isActive) {
    throw new Error("User not found or inactive");
  }

  // Delete old token
  await db.delete(refreshTokens).where(eq(refreshTokens.id, matched.id));

  // Generate new tokens
  const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const newRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(newRefreshToken);
  const expiresAt = getRefreshTokenExpiry();

  // Store new refresh token
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logoutUser(refreshToken: string) {
  const tokens = await db.select().from(refreshTokens);
  const matched = tokens.find((t) => compareToken(refreshToken, t.tokenHash));
  if (matched) {
    await db.delete(refreshTokens).where(eq(refreshTokens.id, matched.id));
  }
}

export async function getUserById(userId: string) {
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}
