import { KiteConnect } from "kiteconnect";
import type { InstrumentMaps } from "../lib/types.js";

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
  maxCount: number = 200
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
    // --- Equity mode: prioritize index constituents, fill with top by price ---
    const priorityStocks: any[] = [];
    const otherStocks: any[] = [];

    for (const inst of filtered) {
      if (PRIORITY_STOCKS.has(inst.tradingsymbol as string)) {
        priorityStocks.push(inst);
      } else {
        otherStocks.push(inst);
      }
    }

    // Sort others by price descending for filling remaining slots
    otherStocks.sort((a: any, b: any) => (b.last_price || 0) - (a.last_price || 0));

    // Priority stocks first, then fill remaining slots
    const remaining = maxCount - priorityStocks.length;
    selected = [...priorityStocks, ...otherStocks.slice(0, Math.max(0, remaining))];

    console.log(`[${mode}] ${priorityStocks.length} index/priority stocks + ${Math.max(0, remaining)} filled by price`);
  }

  // Sort by last_price descending, take top N
  selected.sort((a: any, b: any) => (b.last_price || 0) - (a.last_price || 0));
  const final = selected.slice(0, maxCount);

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
    `[${mode}] Selected ${symbols.length} instruments: ${symbols.slice(0, 10).join(", ")}${symbols.length > 10 ? "..." : ""}`
  );

  return { tokenToSymbol, symbolToToken, symbols };
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
