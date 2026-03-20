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

export async function loadInstruments(
  apiKey: string,
  accessToken: string,
  mode: MarketMode = "commodity",
  maxCount: number = 100
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
    // --- Equity mode: all instruments are directly usable ---
    selected = filtered;
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
