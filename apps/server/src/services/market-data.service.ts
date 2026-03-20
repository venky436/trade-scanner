/**
 * In-Memory Store — holds live quotes, previous day data, and tracks dirty symbols.
 * All data lives in Maps/Sets for fast O(1) lookups.
 */

export interface Quote {
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number; // previous close
  volume: number;
  timestamp: number;
}

export interface PrevDay {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- In-memory maps ---
const quotes = new Map<string, Quote>();
const prevDay = new Map<string, PrevDay>();
const dirtySymbols = new Set<string>();
const subscriptions = new Set<number>(); // instrument tokens currently subscribed

export const marketDataService = {
  // --- Quotes ---
  updateQuote(symbol: string, quote: Quote): void {
    quotes.set(symbol, quote);
    dirtySymbols.add(symbol);
  },

  getQuote(symbol: string): Quote | undefined {
    return quotes.get(symbol);
  },

  getAllQuotes(): Map<string, Quote> {
    return quotes;
  },

  // --- Previous day data ---
  setPrevDay(symbol: string, data: PrevDay): void {
    prevDay.set(symbol, data);
  },

  getPrevDay(symbol: string): PrevDay | undefined {
    return prevDay.get(symbol);
  },

  // --- Dirty symbols (changed since last scan) ---
  getDirtySymbols(): string[] {
    return [...dirtySymbols];
  },

  clearDirty(): void {
    dirtySymbols.clear();
  },

  // --- Subscriptions ---
  addSubscription(token: number): void {
    subscriptions.add(token);
  },

  removeSubscription(token: number): void {
    subscriptions.delete(token);
  },

  getSubscriptions(): Set<number> {
    return subscriptions;
  },

  // --- Stats ---
  getQuoteCount(): number {
    return quotes.size;
  },

  getDirtyCount(): number {
    return dirtySymbols.size;
  },
};
