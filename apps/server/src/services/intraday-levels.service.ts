import type { Candle, SupportResistanceResult } from "../lib/types.js";
import { getSupportResistance } from "./levels.service.js";

const MIN_CANDLES = 15; // Don't compute intraday S/R with fewer candles
const INTRADAY_WINDOW = 50; // Use up to 50 most recent 5-min candles

/**
 * Compute intraday S/R from 5-minute session candles.
 * Reuses the daily getSupportResistance() with intraday-tuned parameters.
 * Returns null if insufficient data.
 */
export function getIntradaySR(
  sessionCandles: Candle[],
  currentPrice: number,
): SupportResistanceResult | null {
  if (sessionCandles.length < MIN_CANDLES || currentPrice <= 0) return null;

  // Use the existing S/R engine with intraday window
  const result = getSupportResistance(sessionCandles, currentPrice, {
    windowSize: INTRADAY_WINDOW,
  });

  return result;
}

/**
 * Select the best S/R level (intraday vs daily) for a given side.
 * Intraday wins only if it passes all safety checks.
 */
export function selectBestSR(
  daily: SupportResistanceResult | undefined,
  intraday: SupportResistanceResult | null,
  currentPrice: number,
  sessionCandleCount: number,
): { sr: SupportResistanceResult | undefined; srType: "INTRADAY" | "DAILY" } {
  // Early market guard: not enough candles → daily only
  if (sessionCandleCount < MIN_CANDLES || !intraday) {
    return { sr: daily, srType: "DAILY" };
  }

  // Check if intraday has valid support
  const intradaySupport = intraday.supportZone;
  const dailySupport = daily?.supportZone;
  let useIntradaySupport = false;

  if (intradaySupport) {
    const dist = Math.abs(currentPrice - intradaySupport.level) / currentPrice;
    // Distance ≤ 1.5% AND touches ≥ 3
    if (dist <= 0.015 && intradaySupport.touches >= 3) {
      // Prefer intraday if closer than daily (or daily doesn't exist)
      if (!dailySupport) {
        useIntradaySupport = true;
      } else {
        const dailyDist = Math.abs(currentPrice - dailySupport.level) / currentPrice;
        useIntradaySupport = dist < dailyDist;
      }
    }
  }

  // Check if intraday has valid resistance
  const intradayResistance = intraday.resistanceZone;
  const dailyResistance = daily?.resistanceZone;
  let useIntradayResistance = false;

  if (intradayResistance) {
    const dist = Math.abs(currentPrice - intradayResistance.level) / currentPrice;
    if (dist <= 0.015 && intradayResistance.touches >= 3) {
      if (!dailyResistance) {
        useIntradayResistance = true;
      } else {
        const dailyDist = Math.abs(currentPrice - dailyResistance.level) / currentPrice;
        useIntradayResistance = dist < dailyDist;
      }
    }
  }

  // If neither side uses intraday, return daily
  if (!useIntradaySupport && !useIntradayResistance) {
    return { sr: daily, srType: "DAILY" };
  }

  // Merge: pick best from each side
  const merged: SupportResistanceResult = {
    support: useIntradaySupport ? intraday.support : (daily?.support ?? null),
    resistance: useIntradayResistance ? intraday.resistance : (daily?.resistance ?? null),
    supportZone: useIntradaySupport ? intraday.supportZone : (daily?.supportZone ?? null),
    resistanceZone: useIntradayResistance ? intraday.resistanceZone : (daily?.resistanceZone ?? null),
    summary: {
      hasNearbySupport: (useIntradaySupport ? intraday.supportZone?.isActionable : daily?.supportZone?.isActionable) ?? false,
      hasNearbyResistance: (useIntradayResistance ? intraday.resistanceZone?.isActionable : daily?.resistanceZone?.isActionable) ?? false,
    },
  };

  return { sr: merged, srType: "INTRADAY" };
}
