export interface InstrumentMaps {
  tokenToSymbol: Map<number, string>;
  symbolToToken: Map<string, number>;
  symbols: string[]; // ordered list of tracked symbols
}

export interface StockSnapshot {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number; // previous close
  volume: number;
  change: number; // (price - close) / close * 100
  timestamp: number;
}

export interface WsMessage {
  type: "snapshot" | "market_update";
  data: StockSnapshot[];
  timestamp: number;
}

export interface Candle {
  time: number; // unix seconds (lightweight-charts wants seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
