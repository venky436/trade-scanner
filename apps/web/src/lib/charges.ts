/**
 * COPY of apps/server/src/lib/charges.ts (keep both identical) — used for
 * OPEN trades' live P&L and the "if stop-loss / if target" amounts.
 *
 * ESTIMATED Zerodha charges for one NSE intraday (MIS) equity round trip.
 *
 * Rates (Zerodha's published equity-intraday charges — verify against your
 * contract note; update here if they change):
 *   Brokerage     0.03% of each order's value, max ₹20 per executed order
 *   STT           0.025% of the SELL value
 *   Exchange      0.00297% of turnover (NSE transaction charge, buy + sell)
 *   SEBI fee      ₹10 per crore of turnover (0.0001%)
 *   GST           18% of (brokerage + exchange + SEBI)
 *   Stamp duty    0.003% of the BUY value
 *
 * It is an estimate (Zerodha rounds some items per contract note), close
 * enough to show P&L after charges and to judge whether a strategy pays.
 */
export const CHARGE_RATES = {
  brokeragePct: 0.0003,
  brokerageCap: 20,
  sttSellPct: 0.00025,
  exchangePct: 0.0000297,
  sebiPct: 0.000001,
  gstPct: 0.18,
  stampBuyPct: 0.00003,
} as const;

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stamp: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param side  entry side — BUY (buy first, sell to exit) or SELL (short: sell first, buy back)
 * @param qty   shares
 * @param entry average entry price
 * @param exit  average exit price (or the current price for an open trade)
 */
export function intradayCharges(side: "BUY" | "SELL", qty: number, entry: number, exit: number): ChargeBreakdown {
  if (!(qty > 0) || !(entry > 0) || !(exit > 0)) return { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, total: 0 };
  const buyValue = (side === "BUY" ? entry : exit) * qty;
  const sellValue = (side === "BUY" ? exit : entry) * qty;
  const turnover = buyValue + sellValue;
  const R = CHARGE_RATES;
  const brokerage = Math.min(R.brokerageCap, buyValue * R.brokeragePct) + Math.min(R.brokerageCap, sellValue * R.brokeragePct);
  const stt = sellValue * R.sttSellPct;
  const exchange = turnover * R.exchangePct;
  const sebi = turnover * R.sebiPct;
  const gst = (brokerage + exchange + sebi) * R.gstPct;
  const stamp = buyValue * R.stampBuyPct;
  const total = brokerage + stt + exchange + sebi + gst + stamp;
  return { brokerage: r2(brokerage), stt: r2(stt), exchange: r2(exchange), sebi: r2(sebi), gst: r2(gst), stamp: r2(stamp), total: r2(total) };
}

/**
 * Estimated charges for one Zerodha position of the day (from its buy / sell
 * totals). An open position also gets the closing leg at the LTP, as if
 * exited now. Brokerage assumes one order per side (₹20 cap each), so a
 * position built from several orders is slightly under-estimated.
 */
export function positionCharges(p: { quantity: number; ltp: number; buyValue: number; sellValue: number }): number {
  let buyValue = p.buyValue, sellValue = p.sellValue;
  if (p.quantity > 0) sellValue += p.quantity * p.ltp; // long still open → sell at LTP
  if (p.quantity < 0) buyValue += -p.quantity * p.ltp; // short still open → buy back at LTP
  if (!(buyValue > 0) && !(sellValue > 0)) return 0;
  const R = CHARGE_RATES;
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(R.brokerageCap, buyValue * R.brokeragePct) + Math.min(R.brokerageCap, sellValue * R.brokeragePct);
  const exchange = turnover * R.exchangePct;
  const sebi = turnover * R.sebiPct;
  const total = brokerage + sellValue * R.sttSellPct + exchange + sebi + (brokerage + exchange + sebi) * R.gstPct + buyValue * R.stampBuyPct;
  return r2(total);
}
