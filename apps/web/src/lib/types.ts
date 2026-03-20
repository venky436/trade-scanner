export interface StockData {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  timestamp: number;
}

export interface MarketMessage {
  type: "snapshot" | "market_update";
  data: StockData[];
  timestamp: number;
}

export type SortKey = "symbol" | "price" | "change" | "volume" | "high" | "low" | "open";
export type SortDirection = "asc" | "desc";

export interface CandleData {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
