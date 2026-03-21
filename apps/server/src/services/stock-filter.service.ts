import { marketDataService } from "./market-data.service.js";

interface StockFilterConfig {
  maxStocks: number;
  minChangePercent: number;
  minRelativeVolume: number;
  minPrice: number;
  refreshIntervalMs: number;
  allSymbols: string[];
  /** Symbols that are always included (indices, etc.) */
  alwaysInclude?: Set<string>;
}

export function createStockFilter(config: StockFilterConfig) {
  let eligibleSymbols: string[] = [];
  let eligibleSet = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function recompute(): void {
    const quotes = marketDataService.getAllQuotes();
    if (quotes.size === 0) return;

    // Compute median volume for relative volume calculation
    const volumes: number[] = [];
    for (const symbol of config.allSymbols) {
      const q = quotes.get(symbol);
      if (q && q.volume > 0) volumes.push(q.volume);
    }
    volumes.sort((a, b) => a - b);
    const medianVolume = volumes.length > 0
      ? volumes.length % 2 === 0
        ? (volumes[volumes.length / 2 - 1] + volumes[volumes.length / 2]) / 2
        : volumes[Math.floor(volumes.length / 2)]
      : 1;

    // Score and filter
    const scored: { symbol: string; score: number }[] = [];

    for (const symbol of config.allSymbols) {
      // Always include certain symbols (indices)
      if (config.alwaysInclude?.has(symbol)) {
        scored.push({ symbol, score: 999 }); // high score = always at top
        continue;
      }

      const q = quotes.get(symbol);
      if (!q || q.lastPrice <= 0) continue;

      // Condition 3: Price floor
      if (q.lastPrice < config.minPrice) continue;

      // Condition 1: Price change
      const changePercent = q.close !== 0
        ? Math.abs((q.lastPrice - q.close) / q.close) * 100
        : 0;

      // Condition 2: Relative volume
      const relativeVolume = medianVolume > 0 ? q.volume / medianVolume : 0;

      // Must pass at least one activity filter
      const passesChange = changePercent >= config.minChangePercent;
      const passesVolume = relativeVolume >= config.minRelativeVolume;

      if (!passesChange && !passesVolume) continue;

      // Score for ranking
      const score = changePercent * 0.6 + relativeVolume * 0.4;
      scored.push({ symbol, score });
    }

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    const prev = eligibleSymbols.length;
    eligibleSymbols = scored.slice(0, config.maxStocks).map((s) => s.symbol);
    eligibleSet = new Set(eligibleSymbols);

    // Log when count changes significantly or periodically
    if (Math.abs(eligibleSymbols.length - prev) >= 5 || prev === 0) {
      const topSymbols = eligibleSymbols.slice(0, 5).join(", ");
      console.log(`[StockFilter] ${eligibleSymbols.length}/${config.allSymbols.length} eligible (top: ${topSymbols})`);
    }
  }

  return {
    start() {
      recompute(); // initial run
      timer = setInterval(recompute, config.refreshIntervalMs);
      timer.unref();
      console.log(`Stock filter started (refresh: ${config.refreshIntervalMs}ms, max: ${config.maxStocks})`);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log("Stock filter stopped");
      }
    },

    /** Top eligible symbols, sorted by activity score */
    getEligibleSymbols(): string[] {
      return eligibleSymbols;
    },

    /** O(1) check if a symbol is currently eligible */
    isEligible(symbol: string): boolean {
      return eligibleSet.has(symbol);
    },

    /** Force refresh (e.g., after initial ticks arrive) */
    refresh(): void {
      recompute();
    },

    getStats(): { eligible: number; total: number } {
      return { eligible: eligibleSymbols.length, total: config.allSymbols.length };
    },
  };
}

export type StockFilter = ReturnType<typeof createStockFilter>;
