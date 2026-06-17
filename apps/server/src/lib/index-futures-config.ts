// Index futures config — pure functions + constants, no service deps.
//
// Single source of truth for which index-future underlyings the scanner
// tracks, how to detect a futures symbol, and how to render the human-
// friendly display name on the frontend.
//
// v1 scope: NIFTY 50 monthly futures only. BANKNIFTY / FINNIFTY can be added
// by appending a string to UNDERLYINGS_TO_TRACK + restarting; no other code
// changes needed.

/**
 * Kite "name" field values for the futures we track. The instrument loader
 * uses this set to filter the NFO-FUT segment down to just our underlyings.
 *
 * Kite convention: `name` is the *underlying*, e.g. "NIFTY" or "BANKNIFTY",
 * NOT the trading symbol ("NIFTY25JUNFUT").
 */
export const INDEX_FUTURE_UNDERLYINGS: ReadonlyArray<string> = ["NIFTY"];

/** Kite exchange code for NSE F&O. */
export const INDEX_FUTURES_EXCHANGE = "NFO";

/** Kite segment code for futures on NFO. */
export const INDEX_FUTURES_SEGMENT = "NFO-FUT";

/**
 * Which contract life to track.
 *   "weekly"  → pick the nearest expiry — Tuesday weeklies AND last-Thursday
 *               monthlies are both eligible; whichever expires sooner wins.
 *               Best for tracking where volume concentrates.
 *   "monthly" → restrict to the last-Thursday monthly contracts only. Stable
 *               contract identity across the month; simpler ops.
 *
 * Switching between modes is a single-line change here + a server restart.
 * Default is "weekly" because user's goal is "follow the volume".
 */
export type FuturesExpiryMode = "weekly" | "monthly";
export const FUTURES_EXPIRY_MODE: FuturesExpiryMode = "weekly";

/**
 * Day-of-week (0=Sun..6=Sat) on which NSE NIFTY MONTHLY futures expire.
 * Used to distinguish monthly contracts from weeklies in monthly-mode.
 * NSE rolls all index F&O monthly expiries to the last Thursday of the month.
 */
export const MONTHLY_EXPIRY_DOW = 4; // Thursday

/**
 * Is the supplied expiry date a "monthly" contract by NSE convention?
 * Monthly = expires on a Thursday. Weekly = expires on a Tuesday (NIFTY).
 * We use UTC weekday because Kite returns dates as midnight-UTC strings.
 */
export function isMonthlyContract(expiry: Date | string | null | undefined): boolean {
  if (expiry === null || expiry === undefined || expiry === "") return false;
  const d = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCDay() === MONTHLY_EXPIRY_DOW;
}

/**
 * Detect whether a trading symbol is a futures contract. Kite's convention
 * is "<NAME><YY><MMM>FUT" for monthly contracts (e.g. NIFTY25JUNFUT).
 * Conservative — only returns true on the exact monthly-FUT shape.
 */
export function isFutureSymbol(symbol: string): boolean {
  return /^[A-Z]+\d{2}[A-Z]{3}FUT$/i.test(symbol);
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Extract the underlying name from a futures trading symbol.
 *   "NIFTY25JUNFUT"     → "NIFTY"
 *   "BANKNIFTY25JUNFUT" → "BANKNIFTY"
 * Returns null for any non-futures symbol.
 */
export function extractUnderlying(tradingSymbol: string): string | null {
  const m = tradingSymbol.match(/^([A-Z]+)\d{2}[A-Z]{3}FUT$/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Render a human-friendly display name for a futures contract.
 *
 * Always includes the day-of-month so a weekly contract and a monthly
 * contract on the same underlying are visually distinguishable at a glance.
 *
 * Examples:
 *   formatFutureDisplayName("NIFTY25JUNFUT", new Date("2026-06-25"))
 *     → "NIFTY 25-Jun FUT"
 *   formatFutureDisplayName("NIFTY25JUNFUT", new Date("2026-06-24"))
 *     → "NIFTY 24-Jun FUT"   (a Tuesday weekly that same month)
 *
 * If the symbol isn't a recognised futures shape, OR the expiry is missing
 * or invalid, fall back to the raw trading symbol so the user is never
 * shown an empty label.
 */
export function formatFutureDisplayName(
  tradingSymbol: string,
  expiry: Date | string | null | undefined,
): string {
  const underlying = extractUnderlying(tradingSymbol);
  const parts = expiryParts(expiry);
  if (!underlying || !parts) return tradingSymbol;
  return `${underlying} ${parts.day}-${parts.month} FUT`;
}

function expiryParts(
  expiry: Date | string | null | undefined,
): { day: number; month: string } | null {
  if (expiry === null || expiry === undefined || expiry === "") return null;
  const d = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(d.getTime())) return null;
  // UTC because Kite returns date strings like "2026-06-25" which parse as
  // midnight UTC — using getMonth()/getDate() (local) would shift on
  // servers in negative UTC offsets.
  return { day: d.getUTCDate(), month: MONTH_LABELS[d.getUTCMonth()] };
}
