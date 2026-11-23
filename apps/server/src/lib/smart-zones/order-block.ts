// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// ORDER BLOCK (OB) — strict detection on 5-min candles, one day at a time.
//
// BULLISH ORDER BLOCK:
//   1. Swing high:   candle s whose high is STRICTLY above the 2 candles on each side
//                    (confirmed only after candle s+2 has closed).
//   2. Break of structure (BOS): candle i is the FIRST candle to CLOSE above that swing high.
//   3. OB candle:    the last RED candle at the start of the move that broke the high —
//                    the leg's lowest candle, or a red candle up to 2 candles before it —
//                    always AFTER the swing candle (in the pullback), never the swing itself.
//                    Its low must be the lowest low of the whole leg (OB … BOS), i.e. the
//                    zone was never broken before the BOS.
//   4. Strength:     BOS close − OB low ≥ dispAtr × ATR, and the leg left a bullish
//                    imbalance (a 3-candle gap) — weak drifts are not order blocks.
//   5. Volume:       BOS candle volume ≥ volMult × average of the 20 candles before it.
//   6. Zone size:    OB height ≥ minZonePct of price and ≤ maxZoneAtr × ATR.
//   7. Trend:        (optional, default on) BOS candle closes above session VWAP.
//   8. Time:         BOS candle opens between 09:25 and 13:50 IST.
// BEARISH: exact mirror (swing low, first close below it, last GREEN candle, etc.).
//
// TRADE: entry = limit at the OB midpoint ("mean threshold") on the first return,
// stop = OB low (bull) / OB high (bear). One OB per broken swing.

import type { Candle, Setup } from "./types.js";
import { avgVolBefore } from "./indicators.js";
import { istMin, hm } from "./time.js";
import { hasImbalance } from "./fvg.js";

export interface ObConfig {
  swingK: number; // candles on each side of a swing point
  dispAtr: number;
  requireImbalance: boolean;
  volMult: number;
  minZonePct: number;
  maxZoneAtr: number;
  vwapFilter: boolean;
  entry: "mid" | "edge"; // mid = 50% of the block, edge = top (bull) / bottom (bear)
  firstBosMin: number;
  lastBosMin: number;
}

export const OB_DEFAULTS: ObConfig = {
  swingK: 2,
  dispAtr: 1.5,
  requireImbalance: true,
  volMult: 1.2,
  minZonePct: 0.0015,
  maxZoneAtr: 2,
  vwapFilter: true,
  entry: "mid",
  firstBosMin: hm(9, 25),
  lastBosMin: hm(13, 50),
};

interface Swing {
  idx: number;
  price: number;
  broken: boolean;
}

/** Swing highs (kind 1) or lows (kind -1) of one day, each with the index at which it is confirmed. */
export function findSwings(c: Candle[], dayStart: number, dayEnd: number, k: number, kind: 1 | -1): { idx: number; price: number; confirmedAt: number }[] {
  const out: { idx: number; price: number; confirmedAt: number }[] = [];
  for (let s = dayStart + k; s + k < dayEnd; s++) {
    const p = kind === 1 ? c[s]!.h : c[s]!.l;
    let ok = true;
    for (let j = s - k; j <= s + k && ok; j++) {
      if (j === s) continue;
      const q = kind === 1 ? c[j]!.h : c[j]!.l;
      if (kind === 1 ? q >= p : q <= p) ok = false;
    }
    if (ok) out.push({ idx: s, price: p, confirmedAt: s + k });
  }
  return out;
}

export function findOrderBlockSetups(c: Candle[], atrArr: number[], vwap: number[], dayStart: number, dayEnd: number, cfg: ObConfig = OB_DEFAULTS): Setup[] {
  return [...side(c, atrArr, vwap, dayStart, dayEnd, cfg, 1), ...side(c, atrArr, vwap, dayStart, dayEnd, cfg, -1)].sort((a, b) => a.formedIdx - b.formedIdx);
}

function side(c: Candle[], atrArr: number[], vwap: number[], dayStart: number, dayEnd: number, cfg: ObConfig, dir: 1 | -1): Setup[] {
  // Work in "bull space": for a bearish search, mirror prices (x → -x, high ↔ low)
  // so one code path handles both sides exactly symmetrically.
  const H = (i: number) => (dir === 1 ? c[i]!.h : -c[i]!.l);
  const L = (i: number) => (dir === 1 ? c[i]!.l : -c[i]!.h);
  const O = (i: number) => (dir === 1 ? c[i]!.o : -c[i]!.o);
  const C = (i: number) => (dir === 1 ? c[i]!.c : -c[i]!.c);
  const back = (x: number) => (dir === 1 ? x : -x);

  const swings: Swing[] = findSwings(c, dayStart, dayEnd, cfg.swingK, dir).map((s) => ({ idx: s.idx, price: dir === 1 ? s.price : -s.price, broken: false }));
  const out: Setup[] = [];
  for (let i = dayStart + 1; i < dayEnd; i++) {
    // the most recent swing confirmed BEFORE candle i, not yet broken
    let sw: Swing | undefined;
    for (const s of swings) if (s.idx + cfg.swingK <= i - 1 && !s.broken) sw = s;
    if (!sw) continue;
    if (!(C(i) > sw.price && C(i - 1) <= sw.price)) continue;
    sw.broken = true; // the first close beyond it — used once, pass or fail
    // older unbroken swings below this close are also taken out
    for (const s of swings) if (s.idx < sw.idx && !s.broken && C(i) > s.price) s.broken = true;

    const m = istMin(c[i]!.t);
    if (m < cfg.firstBosMin || m > cfg.lastBosMin) continue;

    // leg low after the swing
    let k0 = sw.idx + 1;
    for (let j = sw.idx + 1; j <= i; j++) if (L(j) < L(k0)) k0 = j;
    // OB = last "red" candle (bull space: close < open) at k0 or up to 2 before it
    let ob = -1;
    for (let j = k0; j >= Math.max(dayStart, sw.idx + 1, k0 - 2); j--) { // never the swing candle or anything before it
      if (C(j) < O(j)) {
        ob = j;
        break;
      }
    }
    if (ob < 0) continue;
    // the OB low must be the lowest low of the leg OB … BOS
    let legLow = Infinity;
    for (let j = ob; j <= i; j++) legLow = Math.min(legLow, L(j));
    if (L(ob) > legLow) continue;

    const a = atrArr[ob]!;
    if (!(a > 0)) continue;
    if (C(i) - L(ob) < cfg.dispAtr * a) continue;
    if (cfg.requireImbalance && !hasImbalance(c, ob, i, dir)) continue;
    const avgV = avgVolBefore(c, i, 20);
    if (!(avgV > 0) || c[i]!.v < cfg.volMult * avgV) continue;
    const zoneH = H(ob) - L(ob);
    const price = c[i]!.c;
    if (zoneH < cfg.minZonePct * price || zoneH > cfg.maxZoneAtr * a) continue;
    if (cfg.vwapFilter && !(C(i) > back(vwap[i - dayStart]!))) continue;

    const entryB = cfg.entry === "mid" ? (H(ob) + L(ob)) / 2 : H(ob);
    if (!(entryB < C(i))) continue;
    const top = Math.max(back(H(ob)), back(L(ob)));
    const bottom = Math.min(back(H(ob)), back(L(ob)));
    out.push({ strategy: "OB", dir, formedIdx: i, activeFrom: i + 1, entry: back(entryB), stop: back(L(ob)), zoneTop: top, zoneBottom: bottom, swingIdx: sw.idx, obIdx: ob });
  }
  return out;
}
