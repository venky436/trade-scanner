import { KiteTicker } from "kiteconnect";
import type { InstrumentMaps } from "../lib/types.js";
import { marketDataService, type Quote } from "./market-data.service.js";

interface KiteTickerConfig {
  apiKey: string;
  accessToken: string;
  instrumentMaps: InstrumentMaps;
  onTick?: (symbol: string, quote: Quote) => void;
  /** Zerodha pushes every status change of YOUR orders on the same socket. */
  onOrderUpdate?: (order: any) => void;
}

export function createKiteTickerManager(config: KiteTickerConfig) {
  const { apiKey, accessToken, instrumentMaps } = config;
  const tokens = [...instrumentMaps.tokenToSymbol.keys()];

  const ticker = new KiteTicker({
    api_key: apiKey,
    access_token: accessToken,
  });

  let connected = false;

  ticker.on("connect", () => {
    console.log(`KiteTicker connected. Subscribing to ${tokens.length} tokens...`);
    ticker.subscribe(tokens);
    ticker.setMode(ticker.modeFull, tokens);
    connected = true;
  });

  ticker.on("ticks", (ticks: any[]) => {
    for (const tick of ticks) {
      const symbol = instrumentMaps.tokenToSymbol.get(tick.instrument_token);
      if (!symbol) continue;

      const quote: Quote = {
        lastPrice: tick.last_price ?? 0,
        open: tick.ohlc?.open ?? 0,
        high: tick.ohlc?.high ?? 0,
        low: tick.ohlc?.low ?? 0,
        close: tick.ohlc?.close ?? 0,
        volume: tick.volume_traded ?? tick.volume ?? 0,
        timestamp: Date.now(),
      };

      marketDataService.updateQuote(symbol, quote);
      if (config.onTick) config.onTick(symbol, quote);
    }
  });

  ticker.on("order_update", (order: any) => {
    try {
      config.onOrderUpdate?.(order);
    } catch (err) {
      console.error("[KiteTicker] order_update handler failed:", err);
    }
  });

  ticker.on("reconnect", (retries: number, interval: number) => {
    console.log(`KiteTicker reconnecting... attempt ${retries}, interval ${interval}ms`);
    connected = false;
  });

  ticker.on("error", (err: any) => {
    console.error("KiteTicker error:", err);
  });

  ticker.on("close", () => {
    console.log("KiteTicker connection closed");
    connected = false;
  });

  ticker.on("noreconnect", () => {
    console.error("KiteTicker: max reconnection attempts exhausted");
    connected = false;
  });

  return {
    connect() {
      console.log("Connecting KiteTicker...");
      ticker.connect();
    },
    disconnect() {
      ticker.disconnect();
      connected = false;
    },
    isConnected() {
      return connected;
    },
  };
}
