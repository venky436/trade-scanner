import Redis from "ioredis";
import type { SupportResistanceResult } from "../lib/types.js";

interface PrecomputedData {
  levels: Record<string, SupportResistanceResult>;
  avgVolumes: Record<string, number>;
  timestamp: number;
}

const LEVELS_KEY = "market:levels";
const AVGVOL_KEY = "market:avgvolumes";
const META_KEY = "market:meta";

let client: Redis | null = null;
let isConnected = false;
let connectionAttempted = false;

function getClient(): Redis | null {
  if (client) return client;
  if (connectionAttempted) return null; // don't retry or log again

  connectionAttempted = true;

  try {
    client = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
      lazyConnect: true,
    });

    client.on("connect", () => {
      isConnected = true;
      console.log("[Redis] Connected");
    });

    client.on("error", () => {
      isConnected = false;
    });

    client.on("close", () => {
      isConnected = false;
      client = null;
    });

    client.connect().catch(() => {
      console.log("[Redis] Not available — running without cache persistence");
      client = null;
    });

    return client;
  } catch {
    console.log("[Redis] Not available — running without cache persistence");
    return null;
  }
}

export const redisService = {
  // ── Read all precomputed data at once (startup) ──

  async getPrecomputed(): Promise<PrecomputedData | null> {
    const redis = getClient();
    if (!redis || !isConnected) return null;

    try {
      const [levelsRaw, avgVolRaw, metaRaw] = await Promise.all([
        redis.hgetall(LEVELS_KEY),
        redis.hgetall(AVGVOL_KEY),
        redis.get(META_KEY),
      ]);

      if (!levelsRaw || Object.keys(levelsRaw).length === 0) return null;

      const levels: Record<string, SupportResistanceResult> = {};
      for (const [symbol, json] of Object.entries(levelsRaw)) {
        try { levels[symbol] = JSON.parse(json); } catch { /* skip corrupt */ }
      }

      const avgVolumes: Record<string, number> = {};
      for (const [symbol, val] of Object.entries(avgVolRaw)) {
        avgVolumes[symbol] = Number(val);
      }

      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      return { levels, avgVolumes, timestamp: meta.timestamp ?? 0 };
    } catch (err: any) {
      console.warn("[Redis] Failed to read precomputed:", err.message);
      return null;
    }
  },

  // ── Incremental per-symbol writes (during EOD job) ──

  async setLevel(symbol: string, sr: SupportResistanceResult): Promise<boolean> {
    const redis = getClient();
    if (!redis || !isConnected) return false;

    try {
      await redis.hset(LEVELS_KEY, symbol, JSON.stringify(sr));
      return true;
    } catch {
      return false;
    }
  },

  async setAvgVolume(symbol: string, avgVolume: number): Promise<boolean> {
    const redis = getClient();
    if (!redis || !isConnected) return false;

    try {
      await redis.hset(AVGVOL_KEY, symbol, String(avgVolume));
      return true;
    } catch {
      return false;
    }
  },

  async setMeta(data: { timestamp: number; levelsCount: number; duration: number }): Promise<boolean> {
    const redis = getClient();
    if (!redis || !isConnected) return false;

    try {
      await redis.set(META_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  isAvailable(): boolean {
    return isConnected;
  },

  async close(): Promise<void> {
    if (client) {
      await client.quit().catch(() => {});
      client = null;
      isConnected = false;
    }
  },
};
