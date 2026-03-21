export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4002/ws";

export const FLASH_DURATION_MS = 500;

export const OVERVIEW_INDICES = ["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY FIN SERVICE"];

export const INDEX_NAMES = new Set([
  "NIFTY 50",
  "NIFTY BANK",
  "NIFTY NEXT 50",
  "NIFTY MIDCAP 50",
  "NIFTY IT",
  "NIFTY FIN SERVICE",
  "NIFTY AUTO",
  "NIFTY PHARMA",
  "NIFTY METAL",
  "NIFTY ENERGY",
  "NIFTY REALTY",
  "NIFTY FMCG",
  "NIFTY MEDIA",
  "INDIA VIX",
]);
