import { KiteConnect } from "kiteconnect";
import type { InstrumentMaps } from "../lib/types.js";
import {
  FUTURES_EXPIRY_MODE,
  INDEX_FUTURE_UNDERLYINGS,
  INDEX_FUTURES_EXCHANGE,
  INDEX_FUTURES_SEGMENT,
  formatFutureDisplayName,
  isMonthlyContract,
} from "../lib/index-futures-config.js";

export type MarketMode = "commodity" | "equity";

interface ModeConfig {
  exchange: string;
  segment: string;
  instrumentType?: string; // e.g. "EQ" for equity
  needsExpiry: boolean;    // commodities have expiry, equity doesn't
}

const MODE_CONFIGS: Record<MarketMode, ModeConfig> = {
  commodity: {
    exchange: "MCX",
    segment: "MCX-FUT",
    needsExpiry: true,
  },
  equity: {
    exchange: "NSE",
    segment: "NSE",
    instrumentType: "EQ",
    needsExpiry: false,
  },
};

// Nifty 50 constituents
const NIFTY_50 = [
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BPCL",
  "BHARTIARTL", "BRITANNIA", "CIPLA", "COALINDIA", "DRREDDY",
  "EICHERMOT", "ETERNAL", "GRASIM", "HCLTECH", "HDFCBANK",
  "HDFCLIFE", "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK",
  "ITC", "INDUSINDBK", "INFY", "JSWSTEEL", "JIOFIN",
  "KOTAKBANK", "LT", "M&M", "MARUTI", "NTPC",
  "NESTLEIND", "ONGC", "POWERGRID", "RELIANCE", "SBILIFE",
  "SBIN", "SUNPHARMA", "TCS", "TATACONSUM", "TATAMOTORS",
  "TATASTEEL", "TECHM", "TITAN", "TRENT", "ULTRACEMCO",
  "WIPRO",
];

// Nifty Next 50 constituents
const NIFTY_NEXT_50 = [
  "ABB", "ADANIGREEN", "ADANIPOWER", "AMBUJACEM", "ATGL",
  "BANKBARODA", "BOSCHLTD", "CANBK", "CHOLAFIN", "COLPAL",
  "DLF", "DABUR", "DIVISLAB", "GAIL", "GODREJCP",
  "HAVELLS", "HAL", "HINDPETRO", "IOC", "ICICIPRULI",
  "INDIGO", "IRFC", "IRCTC", "JINDALSTEL", "JSWENERGY",
  "LICI", "LUPIN", "MANKIND", "MARICO", "MOTHERSON",
  "NHPC", "NMDC", "NAUKRI", "PFC", "PIDILITIND",
  "PNB", "RECLTD", "SBICARD", "SRF", "SHREECEM",
  "SHRIRAMFIN", "SIEMENS", "TATAELXSI", "TATAPOWER", "TORNTPHARM",
  "UNIONBANK", "UNITDSPR", "VBL", "VEDL", "ZOMATO",
];

// Additional high-interest stocks (Nifty Midcap Select / popular)
const EXTRA_STOCKS = [
  "AUROPHARMA", "BAJAJHLDNG", "BERGEPAINT", "BIOCON", "CANFINHOME",
  "CONCOR", "COFORGE", "CROMPTON", "CUMMINSIND", "DMART",
  "ESCORTS", "FEDERALBNK", "FORTIS", "GMRAIRPORT", "IDFCFIRSTB",
  "IEX", "INDHOTEL", "INDUSTOWER", "IREDA", "KALYANKJIL",
  "KEI", "L&TFH", "LTIM", "LTTS", "LALPATHLAB",
  "LODHA", "M&MFIN", "MFSL", "MAXHEALTH", "MPHASIS",
  "MUTHOOTFIN", "NAM-INDIA", "OBEROIRLTY", "OFSS", "PAGEIND",
  "PERSISTENT", "PETRONET", "PHOENIXLTD", "PIIND", "POLYCAB",
  "PRESTIGE", "SONACOMS", "SUNDARMFIN", "SUPREMEIND", "SYNGENE",
  "TATACHEM", "TIINDIA", "TORNTPOWER", "TVSMOTOR", "UPL",
  "VOLTAS", "YESBANK", "ZYDUSLIFE",
];

// Combined priority list — index stocks first, then extras
const PRIORITY_STOCKS = new Set([...NIFTY_50, ...NIFTY_NEXT_50, ...EXTRA_STOCKS]);

// Indices to subscribe to (Kite provides these in NSE segment)
const INDEX_SYMBOLS = [
  "NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY MIDCAP 50",
  "NIFTY IT", "NIFTY FIN SERVICE", "NIFTY AUTO",
  "NIFTY PHARMA", "NIFTY METAL", "NIFTY ENERGY",
  "NIFTY REALTY", "NIFTY FMCG", "NIFTY MEDIA",
  "INDIA VIX",
];

export async function loadInstruments(
  apiKey: string,
  accessToken: string,
  mode: MarketMode = "commodity",
  maxCount: number = 500
): Promise<InstrumentMaps> {
  const modeConfig = MODE_CONFIGS[mode];

  const kc = new KiteConnect({ api_key: apiKey });
  kc.setAccessToken(accessToken);

  console.log(`[${mode}] Fetching instruments from ${modeConfig.exchange}...`);
  const instruments = await kc.getInstruments(modeConfig.exchange as any);
  console.log(`[${mode}] Fetched ${instruments.length} total instruments`);

  // Filter by segment
  let filtered = instruments.filter(
    (i: any) => i.segment === modeConfig.segment
  );

  // For equity, filter by instrument_type = "EQ"
  if (modeConfig.instrumentType) {
    filtered = filtered.filter(
      (i: any) => i.instrument_type === modeConfig.instrumentType
    );
  }

  console.log(`[${mode}] ${filtered.length} instruments after segment/type filter`);

  let selected: any[];

  if (modeConfig.needsExpiry) {
    // --- Commodity mode: pick nearest-expiry contract per commodity ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active = filtered.filter((i: any) => {
      if (!i.expiry) return false;
      return new Date(i.expiry) >= today;
    });
    console.log(`[${mode}] ${active.length} active (non-expired) instruments`);

    // Group by commodity name (e.g., "GOLD", "SILVER", "CRUDEOIL")
    const grouped = new Map<string, any[]>();
    for (const inst of active) {
      const name = inst.name as string;
      if (!name) continue;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push(inst);
    }

    // For each commodity, pick the nearest expiry (most liquid)
    selected = [];
    for (const [, contracts] of grouped) {
      contracts.sort(
        (a: any, b: any) =>
          new Date(a.expiry).getTime() - new Date(b.expiry).getTime()
      );
      selected.push(contracts[0]);
    }
  } else {
    // --- Equity mode: Phase 0 filtering (NO API calls, O(N)) ---
    const MIN_PRICE = 50;
    const MAX_PRICE = 5000;

    const priorityStocks: any[] = [];
    const eligibleOthers: any[] = [];
    let removedPrice = 0;

    for (const inst of filtered) {
      const symbol = inst.tradingsymbol as string;
      const price = inst.last_price || 0;

      // Priority stocks always included (NIFTY_50, NIFTY_NEXT_50, EXTRA_STOCKS)
      if (PRIORITY_STOCKS.has(symbol)) {
        priorityStocks.push(inst);
        continue;
      }

      // Phase 0 Filter: Price range (skip if price unknown)
      if (price > 0 && (price < MIN_PRICE || price > MAX_PRICE)) {
        removedPrice++;
        continue;
      }

      eligibleOthers.push(inst);
    }

    // Sort eligible others by price descending (higher price = more liquid typically)
    eligibleOthers.sort((a: any, b: any) => (b.last_price || 0) - (a.last_price || 0));

    // Cap non-priority stocks to keep total manageable
    const maxOthers = Math.max(0, maxCount - priorityStocks.length);
    selected = [...priorityStocks, ...eligibleOthers.slice(0, maxOthers)];

    console.log(`[${mode}] Phase 0 filter: ${filtered.length} → ${selected.length} stocks`);
    console.log(`[${mode}]   Priority (always included): ${priorityStocks.length}`);
    console.log(`[${mode}]   Price filter (₹${MIN_PRICE}-₹${MAX_PRICE}): removed ${removedPrice}`);
    console.log(`[${mode}]   Eligible others: ${eligibleOthers.length} (capped to ${maxOthers})`);
  }

  // Sort by last_price descending
  selected.sort((a: any, b: any) => (b.last_price || 0) - (a.last_price || 0));
  const final = selected;

  // Store ALL filtered instruments for search (before selection cap)
  const allInstruments = filtered.map((i: any) => ({
    symbol: i.tradingsymbol as string,
    token: Number(i.instrument_token),
    lastPrice: Number(i.last_price) || 0,
  }));

  // Build bidirectional maps
  const tokenToSymbol = new Map<number, string>();
  const symbolToToken = new Map<string, number>();
  const symbols: string[] = [];

  for (const inst of final) {
    const token = Number(inst.instrument_token);
    const symbol = inst.tradingsymbol as string;
    tokenToSymbol.set(token, symbol);
    symbolToToken.set(symbol, token);
    symbols.push(symbol);
  }

  console.log(
    `[${mode}] Selected ${symbols.length} instruments (${allInstruments.length} searchable): ${symbols.slice(0, 10).join(", ")}${symbols.length > 10 ? "..." : ""}`
  );

  return { tokenToSymbol, symbolToToken, symbols, allInstruments };
}

/**
 * Load NSE index instruments (NIFTY 50, NIFTY BANK, etc.)
 * These are separate from equity stocks — used for market overview.
 */
export async function loadIndices(
  apiKey: string,
  accessToken: string,
): Promise<InstrumentMaps> {
  const kc = new KiteConnect({ api_key: apiKey });
  kc.setAccessToken(accessToken);

  console.log("[indices] Fetching NSE instruments for index lookup...");
  const instruments = await kc.getInstruments("NSE" as any);

  // Indices have segment = "INDICES"
  const indices = instruments.filter(
    (i: any) => i.segment === "INDICES"
  );

  console.log(`[indices] Found ${indices.length} index instruments`);

  // Match against our desired index list
  const indexSet = new Set(INDEX_SYMBOLS);
  const matched = indices.filter(
    (i: any) => indexSet.has(i.tradingsymbol as string) || indexSet.has(i.name as string)
  );

  const tokenToSymbol = new Map<number, string>();
  const symbolToToken = new Map<string, number>();
  const symbols: string[] = [];

  for (const inst of matched) {
    const token = Number(inst.instrument_token);
    const symbol = inst.tradingsymbol as string;
    tokenToSymbol.set(token, symbol);
    symbolToToken.set(symbol, token);
    symbols.push(symbol);
  }

  console.log(
    `[indices] Selected ${symbols.length} indices: ${symbols.join(", ")}`
  );

  return { tokenToSymbol, symbolToToken, symbols };
}

// ─── Index futures (NIFTY, BANKNIFTY, …) ────────────────────────────────────
//
// Module-level map of (trading symbol → human-friendly display name), populated
// by loadIndexFutures() and queried later by the snapshot transformer.
// Empty when index-futures loading hasn't run or returned no contracts.
const futuresDisplayNames = new Map<string, string>();

/**
 * Look up the display name for an index-futures trading symbol.
 *   getFutureDisplayName("NIFTY25JUNFUT") → "NIFTY (Jun FUT)"
 * Returns null if the symbol isn't a tracked future (so callers know to use
 * the raw symbol).
 */
export function getFutureDisplayName(tradingSymbol: string): string | null {
  return futuresDisplayNames.get(tradingSymbol) ?? null;
}

/**
 * Load the near-month futures contract(s) for every underlying in
 * INDEX_FUTURE_UNDERLYINGS (v1: just NIFTY). Reuses the "group by name,
 * sort by expiry, pick nearest" pattern that already powers commodity-mode
 * contract selection.
 *
 * Returns an InstrumentMaps shaped the same as loadInstruments() / loadIndices()
 * so the caller can merge it into the global subscription set.
 *
 * As a side-effect, populates the module-level futuresDisplayNames map so
 * the snapshot transformer can render "NIFTY (Jun FUT)" on cards.
 *
 * Fail-soft: if Kite returns no matching futures (e.g. all underlyings have
 * already expired and the next contract hasn't been listed yet), returns
 * empty maps + logs a warning. Server keeps booting.
 */
export async function loadIndexFutures(
  apiKey: string,
  accessToken: string,
): Promise<InstrumentMaps> {
  const kc = new KiteConnect({ api_key: apiKey });
  kc.setAccessToken(accessToken);

  console.log(
    `[index_futures] Fetching ${INDEX_FUTURES_EXCHANGE} instruments for: ${INDEX_FUTURE_UNDERLYINGS.join(", ")}`,
  );
  const instruments = await kc.getInstruments(INDEX_FUTURES_EXCHANGE as any);
  console.log(`[index_futures] Fetched ${instruments.length} total ${INDEX_FUTURES_EXCHANGE} instruments`);

  const underlyingSet = new Set(INDEX_FUTURE_UNDERLYINGS);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter: futures segment, our underlyings only, not yet expired.
  // In monthly mode, also exclude weekly contracts (= anything not expiring
  // on a Thursday). Weekly mode keeps all expiries — the picker below then
  // chooses whichever is nearest.
  const candidates = instruments.filter((i: any) => {
    if (i.segment !== INDEX_FUTURES_SEGMENT) return false;
    if (!underlyingSet.has(i.name as string)) return false;
    if (!i.expiry) return false;
    if (new Date(i.expiry) < today) return false;
    if (FUTURES_EXPIRY_MODE === "monthly" && !isMonthlyContract(i.expiry)) return false;
    return true;
  });
  console.log(
    `[index_futures] mode=${FUTURES_EXPIRY_MODE}: ${candidates.length} active candidates for tracked underlyings`,
  );

  // Group by underlying name, then pick the nearest expiry per group
  const grouped = new Map<string, any[]>();
  for (const inst of candidates) {
    const name = inst.name as string;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name)!.push(inst);
  }

  const selected: any[] = [];
  for (const [, contracts] of grouped) {
    contracts.sort(
      (a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime(),
    );
    selected.push(contracts[0]);
  }

  // Clear any stale entries from a previous load (e.g. on rollover restart)
  // and rebuild from the fresh selection.
  futuresDisplayNames.clear();

  const tokenToSymbol = new Map<number, string>();
  const symbolToToken = new Map<string, number>();
  const symbols: string[] = [];

  for (const inst of selected) {
    const token = Number(inst.instrument_token);
    const symbol = inst.tradingsymbol as string;
    const displayName = formatFutureDisplayName(symbol, inst.expiry);
    tokenToSymbol.set(token, symbol);
    symbolToToken.set(symbol, token);
    symbols.push(symbol);
    futuresDisplayNames.set(symbol, displayName);
  }

  if (symbols.length === 0) {
    console.warn(
      `[index_futures] No active futures found for ${INDEX_FUTURE_UNDERLYINGS.join(", ")} — index futures will be unavailable until a contract is listed. Scanner continues normally.`,
    );
  } else {
    const description = symbols
      .map((s) => `${s} → ${futuresDisplayNames.get(s) ?? s}`)
      .join(", ");
    console.log(`[index_futures] Selected ${symbols.length} near-month contract(s): ${description}`);
  }

  return { tokenToSymbol, symbolToToken, symbols };
}
