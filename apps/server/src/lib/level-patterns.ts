// CANDLESTICK PATTERN AT A LINE — display only (a note on cards / stock page).
// Feeds no engine, score or call.
//
// Looks at the last `lookback` closed 5-min candles (default 3 = 15 min) of
// today. A pattern counts only if it forms AT one of today's frozen lines:
//   bullish reversal pattern at a SUPPORT line (S1–S3):
//     the pattern's low reached the line's zone (≤ zone top + 0.1 ATR) and the
//     candle closed at or above the zone's bottom (support held)
//   bearish reversal pattern at a RESISTANCE line (R1–R3):
//     the pattern's high reached the zone (≥ zone bottom − 0.1 ATR) and the
//     candle closed at or below the zone's top (resistance held)
// Patterns come from lib/candle-patterns.ts (strict: prior move, at the
// extreme, exact shapes, real candle size). The most recent match wins; ties
// → the line nearest to the close.

import type { Candle } from "./types.js";
import type { DayLevels, DayLevelName } from "./day-levels.js";
import { bullish, bearish } from "./candle-patterns.js";
import { computeATR } from "./atr.js";

export interface LevelPattern {
  pattern: string; // e.g. "HAMMER"
  side: "BULLISH" | "BEARISH";
  line: DayLevelName; // S1…S3 / R1…R3
  level: number;
  time: number; // open time of the candle that completed the pattern (epoch s)
}

export function patternAtLine(day: DayLevels | null, session: Candle[], lookback = 3): LevelPattern | null {
  if (!day || day.levels.length === 0 || session.length === 0) return null;
  for (let i = session.length - 1; i >= Math.max(0, session.length - lookback); i--) {
    const cs = session.slice(0, i + 1);
    const c = cs[i]!;
    const atr = computeATR(cs, 14);
    if (!atr || !(atr > 0)) continue;
    const last3 = cs.slice(-3), lo = Math.min(...last3.map((x) => x.low)), hi = Math.max(...last3.map((x) => x.high));
    const found: LevelPattern[] = [];
    const bull = bullish(cs);
    if (bull.length) {
      for (const l of day.levels) if (l.kind === "SUPPORT" && lo <= l.max + 0.1 * atr && c.close >= l.min) found.push({ pattern: bull[0]!, side: "BULLISH", line: l.name, level: l.level, time: c.time });
    }
    const bear = bearish(cs);
    if (bear.length) {
      for (const l of day.levels) if (l.kind === "RESISTANCE" && hi >= l.min - 0.1 * atr && c.close <= l.max) found.push({ pattern: bear[0]!, side: "BEARISH", line: l.name, level: l.level, time: c.time });
    }
    if (found.length) return found.sort((a, b) => Math.abs(c.close - a.level) - Math.abs(c.close - b.level))[0]!;
  }
  return null;
}
