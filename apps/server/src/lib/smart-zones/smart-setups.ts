// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// SMART SETUPS — FVGs and Order Blocks that come with a CLEAR prior move (context.ts):
//   REVERSAL  clear fall → bottom → turn → bullish FVG / OB  = BUY   (mirror: SELL after a clear rise)
//   TREND     clear fall still running → bearish FVG / OB    = SELL  (mirror: BUY inside a clear rise)
// Any FVG / OB without a clear move before it is ignored. The FVG noise rules are unchanged
// (gap ≥ 0.25% and ≥ 0.5 × ATR, strong high-volume middle candle); the VWAP rule is OFF here,
// because after a fall price is normally below VWAP and the reversal BUY is exactly what we want.
// Stop: REVERSAL → beyond the bottom / top of the prior move; TREND → the pattern's own stop.

import type { Candle, Setup } from "./types.js";
import { findFvgSetups, FVG_DEFAULTS } from "./fvg.js";
import { findOrderBlockSetups, OB_DEFAULTS } from "./order-block.js";
import { patternContext, CONTEXT_DEFAULTS, type Context, type ContextConfig } from "./context.js";

export interface SmartSetup extends Setup {
  context: Context;
}

export function findSmartSetups(c: Candle[], atrArr: number[], vwap: number[], dayStart: number, dayEnd: number, ctxCfg: ContextConfig = CONTEXT_DEFAULTS): SmartSetup[] {
  const out: SmartSetup[] = [];
  const fvgs = findFvgSetups(c, atrArr, vwap, dayStart, dayEnd, { ...FVG_DEFAULTS, vwapFilter: false });
  for (const s of fvgs) {
    const ctx = patternContext(c, atrArr, dayStart, s.formedIdx - 2, s.formedIdx, s.dir, ctxCfg);
    if (ctx) out.push(withStop(s, ctx));
  }
  const obs = findOrderBlockSetups(c, atrArr, vwap, dayStart, dayEnd, { ...OB_DEFAULTS, vwapFilter: false });
  for (const s of obs) {
    const ctx = patternContext(c, atrArr, dayStart, s.obIdx!, s.formedIdx, s.dir, ctxCfg);
    if (ctx) out.push(withStop(s, ctx));
  }
  return out.sort((a, b) => a.formedIdx - b.formedIdx || a.strategy.localeCompare(b.strategy));
}

function withStop(s: Setup, ctx: Context): SmartSetup {
  if (ctx.kind !== "REVERSAL") return { ...s, context: ctx };
  // beyond the bottom (BUY) / top (SELL) of the move that just ended
  const stop = s.dir === 1 ? Math.min(s.stop, ctx.legTo) : Math.max(s.stop, ctx.legTo);
  return { ...s, stop, context: ctx };
}
