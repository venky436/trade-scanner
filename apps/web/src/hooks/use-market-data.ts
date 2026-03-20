"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StockData, MarketMessage } from "@/lib/types";
import { WS_URL } from "@/lib/constants";

interface UseMarketDataReturn {
  stockMap: Map<string, StockData>;
  isConnected: boolean;
  error: string | null;
}

export function useMarketData(wsUrl: string = WS_URL): UseMarketDataReturn {
  const [stockMap, setStockMap] = useState<Map<string, StockData>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setError(null);
        retriesRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg: MarketMessage = JSON.parse(event.data);

          if (msg.type === "snapshot") {
            const newMap = new Map<string, StockData>();
            for (const stock of msg.data) {
              newMap.set(stock.symbol, stock);
            }
            setStockMap(newMap);
          } else if (msg.type === "market_update") {
            setStockMap(prev => {
              const updated = new Map(prev);
              for (const stock of msg.data) {
                updated.set(stock.symbol, stock);
              }
              return updated;
            });
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);

        // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
        const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30000);
        retriesRef.current++;

        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setError("Connection error");
        ws.close();
      };
    } catch {
      setError("Failed to connect");
    }
  }, [wsUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { stockMap, isConnected, error };
}
