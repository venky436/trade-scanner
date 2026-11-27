import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SESSION_FILE = join(process.cwd(), "data", ".kite-session.json");

interface StoredSession {
  accessToken: string;
  savedAt: number; // epoch ms
}

/**
 * Kite access tokens are valid for one trading day (until ~6 AM next day).
 * We treat anything older than 14 hours as expired to be safe.
 */
const MAX_AGE_MS = 14 * 60 * 60 * 1000;

export function saveSession(accessToken: string): void {
  const data: StoredSession = { accessToken, savedAt: Date.now() };
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(data), "utf-8");
}

export function loadSession(): string | null {
  try {
    const raw = readFileSync(SESSION_FILE, "utf-8");
    const data: StoredSession = JSON.parse(raw);

    if (Date.now() - data.savedAt > MAX_AGE_MS) {
      // Expired — clean up
      clearSession();
      return null;
    }

    return data.accessToken;
  } catch {
    return null;
  }
}

/** Start of the current Kite "token day": the most recent 06:00 IST (Kite expires all tokens around 6 AM). */
export function lastKiteReset(nowMs = Date.now()): number {
  const IST = 330 * 60_000;
  const ist = new Date(nowMs + IST);
  const sixToday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0) - IST;
  return nowMs >= sixToday ? sixToday : sixToday - 24 * 60 * 60 * 1000;
}

/** True when there is a saved Kite token from BEFORE the latest 06:00 IST reset → it has expired, re-login needed. */
export function isSessionExpired(nowMs = Date.now()): boolean {
  try {
    const data: StoredSession = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    return typeof data.savedAt === "number" && data.savedAt < lastKiteReset(nowMs);
  } catch {
    return false; // no saved session (e.g. token from .env) → can't tell, don't nag
  }
}

export function clearSession(): void {
  try {
    unlinkSync(SESSION_FILE);
  } catch {
    // file may not exist
  }
}
