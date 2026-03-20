import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

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

export function clearSession(): void {
  try {
    unlinkSync(SESSION_FILE);
  } catch {
    // file may not exist
  }
}
