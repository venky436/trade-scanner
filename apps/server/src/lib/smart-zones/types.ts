/** One 5-minute candle. `t` = candle OPEN time, epoch seconds (09:15 candle closes at 09:20). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** 1 = long (BUY first), -1 = short (SELL first). */
export type Dir = 1 | -1;

/** A zone found by a strategy, waiting for price to come back to it. */
export interface Setup {
  strategy: string;
  dir: Dir;
  formedIdx: number; // index of the candle that completed the pattern
  activeFrom: number; // first candle allowed to fill the entry order
  entry: number; // limit price
  stop: number;
  zoneTop: number;
  zoneBottom: number;
  /** Order Block only: the swing candle that was broken and the block candle (for charts). */
  swingIdx?: number;
  obIdx?: number;
}

export type ExitReason = "STOP" | "STOP_GAP" | "TARGET" | "TARGET_GAP" | "EOD";

/** Result of trading one setup on one stock (price only — no quantity yet). */
export interface SimResult {
  dir: Dir;
  fillIdx: number;
  fill: number;
  stop: number;
  riskPerShare: number;
  exitIdx: number;
  exit: number;
  reason: ExitReason;
}
