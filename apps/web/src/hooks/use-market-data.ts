"use client";

import { useContext } from "react";
import { MarketDataContext } from "@/context/market-data-context";

export function useMarketData() {
  return useContext(MarketDataContext);
}
