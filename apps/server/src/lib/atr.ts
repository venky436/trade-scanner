import type { Candle } from "./types.js";

// ATR (Average True Range) — Wilder's classic intraday volatility measure.
// True Range = max(high-low, |high - prevClose|, |low - prevClose|).
// ATR = simple mean of TR over the last N closed candles.
//
// We use simple mean (not Wilder's smoothing) for two reasons:
//   1. Each ATR is computed from scratch every 500ms broadcast tick — there's
//      no running state to smooth across, so a simple mean over the window
//      matches what callers expect.
//   2. The 5-min candle window we operate on is short (≤ 14 candles ≈ 70 min);
//      smoothing meaningfully changes very little vs the mean over this length.
//
// Fallbacks when candle data is short:
//   - ≥ 8 candles → 7-period ATR (caller passes period=7)
//   - < 8 candles → caller falls back to volatility-score derived ATR
//   - < 2 candles → returns null (no TR can be computed without a prior close)
//
// Returns null instead of throwing or zeroing so callers can choose a fallback
// path. Never returns 0 from a valid computation — TR is always ≥ 0 and zero
// only occurs when both candles are perfect dojis at the same price, in which
// case the caller's percent-based fallback is the right answer anyway.
export function computeATR(candles: Candle[] | undefined, period = 14): number | null {
  if (!candles || candles.length < 2) return null;
  const sampleCount = Math.min(period + 1, candles.length);
  const window = candles.slice(-sampleCount);
  const trs: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const cur = window[i];
    const prev = window[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  return trs.reduce((sum, x) => sum + x, 0) / trs.length;
}
