"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type IPriceLine,
  type AutoscaleInfo,
} from "lightweight-charts";
import type { CandleData, DayLevelsView } from "@/lib/types";

// Minimal tick shape for live chart updates — kept narrow so the chart doesn't
// depend on the full IntelligenceSnapshot (volume isn't part of the public payload).
// lightweight-charts always shows times as UTC. NSE runs on IST (UTC+5:30), so
// we shift every timestamp by +5:30 ONLY when handing it to the chart — the
// axis and crosshair then read 09:15, 10:00 … 15:30 India time. Candle data
// and live-tick bucketing stay in real epoch seconds (5:30 is a whole number
// of 5-min candles, so candle boundaries are unaffected).
const IST_OFFSET_SECONDS = 5.5 * 60 * 60;
function toChartTime(epochSeconds: number): Time {
  return (epochSeconds + IST_OFFSET_SECONDS) as Time;
}

// ── Time axis labels (IST) ──────────────────────────────────────────────────
// Chart times are already shifted to IST (toChartTime), so read them with UTC
// getters. Every label is a clock time; the first candle of a day also gets
// the date, e.g. "9 Nov 09:15".
const CANDLE_SPACING_PX = 46;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function chartDate(time: Time): Date {
  return new Date((time as number) * 1000);
}

function hhmm(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatTickMark(time: Time, tickMarkType: TickMarkType): string {
  const d = chartDate(time);
  if (tickMarkType === TickMarkType.Time || tickMarkType === TickMarkType.TimeWithSeconds) return hhmm(d);
  // Day / month / year boundary = first candle of a new session
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hhmm(d)}`;
}

function formatCrosshairTime(time: Time): string {
  const d = chartDate(time);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}  ${hhmm(d)}`;
}

export interface ChartTick {
  price: number;
  timestamp: number;
  volume?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

const INTERVAL_MAP: Record<string, { api: string; seconds: number }> = {
  "1m": { api: "minute", seconds: 60 },
  "5m": { api: "5minute", seconds: 300 },
  "15m": { api: "15minute", seconds: 900 },
  "30m": { api: "30minute", seconds: 1800 },
  "1H": { api: "60minute", seconds: 3600 },
  "1D": { api: "day", seconds: 86400 },
};

// ── MA computation ──

function computeMA(candles: CandleData[], period: number): LineData<Time>[] {
  const result: LineData<Time>[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    result.push({ time: toChartTime(candles[i].time), value: sum / period });
  }
  return result;
}

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  tick: ChartTick | null;
  days?: number;
  supportLevel?: number | null;
  resistanceLevel?: number | null;
  supportTouches?: number;
  resistanceTouches?: number;
  /** Your ACTIVE trade on this stock → entry / stop-loss / target lines. null = none. */
  tradeLevels?: TradeLevels | null;
  /** Today's frozen lines (S1–S3 green, R1–R3 red). When given, drawn instead of the single S/R lines. */
  dayLevels?: DayLevelsView | null;
  className?: string;
}

export interface TradeLevels {
  side: "BUY" | "SELL";
  entry: number | null; // null until the entry fills
  stopLoss: number;
  target: number;
}

export function CandlestickChart({
  symbol,
  interval,
  tick,
  days: daysProp,
  supportLevel,
  resistanceLevel,
  supportTouches,
  resistanceTouches,
  tradeLevels,
  dayLevels,
  className,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastCandleRef = useRef<CandleData | null>(null);
  const intervalSecondsRef = useRef(60);
  const supportLineRef = useRef<IPriceLine | null>(null);
  const resistanceLineRef = useRef<IPriceLine | null>(null);
  const dayLineRefs = useRef<IPriceLine[]>([]);
  const [chartReady, setChartReady] = useState(false);

  const { resolvedTheme } = useTheme();

  const getThemeColors = useCallback((theme: string | undefined) => {
    const isDark = theme !== "light";
    return {
      grid: isDark ? "#27272a" : "#e4e4e7",
      text: isDark ? "#a1a1aa" : "#71717a",
      border: isDark ? "#27272a" : "#e4e4e7",
    };
  }, []);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const colors = getThemeColors(resolvedTheme);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: colors.border,
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: false,
        // Wide enough that every 5-min candle gets its own time label
        // (09:15, 09:20, …). Zooming out still works; labels then thin out.
        barSpacing: CANDLE_SPACING_PX,
        minBarSpacing: 2,
        rightOffset: 2,
        tickMarkFormatter: formatTickMark,
      },
      // Crosshair label: full date + time of the hovered candle (IST)
      localization: { timeFormatter: formatCrosshairTime },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // 20 MA line (pink/red)
    const ma20Series = chart.addSeries(LineSeries, {
      color: "#f472b6",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "20 MA",
    });

    // 50 MA line (yellow)
    const ma50Series = chart.addSeries(LineSeries, {
      color: "#facc15",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "50 MA",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ma20SeriesRef.current = ma20Series;
    ma50SeriesRef.current = ma50Series;
    setChartReady(true);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma50SeriesRef.current = null;
      supportLineRef.current = null;
      resistanceLineRef.current = null;
      dayLineRefs.current = [];
      setChartReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update chart theme
  useEffect(() => {
    if (!chartRef.current) return;
    const colors = getThemeColors(resolvedTheme);
    chartRef.current.applyOptions({
      layout: { textColor: colors.text },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    });
  }, [resolvedTheme, getThemeColors]);

  // Active trade lines: entry (dotted), stop-loss (red), target (green).
  // The price scale is widened to include them so they're always visible.
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const tradeLevelsRef = useRef<TradeLevels | null>(null);
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;
    const series = candleSeriesRef.current;
    for (const line of tradeLinesRef.current) series.removePriceLine(line);
    tradeLinesRef.current = [];
    tradeLevelsRef.current = tradeLevels ?? null;

    if (tradeLevels) {
      const fmt = (p: number) => p.toFixed(2);
      tradeLinesRef.current.push(
        series.createPriceLine({
          price: tradeLevels.stopLoss,
          color: "#f43f5e",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `SL ${fmt(tradeLevels.stopLoss)}`,
        }),
        series.createPriceLine({
          price: tradeLevels.target,
          color: "#10b981",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `Target ${fmt(tradeLevels.target)}`,
        }),
      );
      if (tradeLevels.entry != null) {
        tradeLinesRef.current.push(
          series.createPriceLine({
            price: tradeLevels.entry,
            color: tradeLevels.side === "BUY" ? "#3b82f6" : "#f97316",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${tradeLevels.side === "BUY" ? "Buy" : "Sell"} ${fmt(tradeLevels.entry)}`,
          }),
        );
      }
    }

    // keep SL / target / entry inside the visible price range
    series.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const base = original();
        const lv = tradeLevelsRef.current;
        if (!base || !base.priceRange || !lv) return base;
        const vals = [lv.stopLoss, lv.target, ...(lv.entry != null ? [lv.entry] : [])];
        return {
          ...base,
          priceRange: {
            minValue: Math.min(base.priceRange.minValue, ...vals),
            maxValue: Math.max(base.priceRange.maxValue, ...vals),
          },
        };
      },
    });
  }, [tradeLevels?.side, tradeLevels?.entry, tradeLevels?.stopLoss, tradeLevels?.target, chartReady]);

  // Draw S/R price lines.
  // Belt-and-suspenders inversion guard: even if a caller forgets to pre-validate,
  // never draw a "support" line above the live price (or "resistance" below).
  // Compares against tick.price (live), falling back to nothing if no tick has
  // arrived yet (then we just trust the caller).
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    if (supportLineRef.current) { series.removePriceLine(supportLineRef.current); supportLineRef.current = null; }
    if (resistanceLineRef.current) { series.removePriceLine(resistanceLineRef.current); resistanceLineRef.current = null; }

    const livePrice = tick?.price ?? null;
    const safeSupport =
      livePrice !== null && supportLevel != null && supportLevel >= livePrice
        ? null
        : supportLevel;
    const safeResistance =
      livePrice !== null && resistanceLevel != null && resistanceLevel <= livePrice
        ? null
        : resistanceLevel;

    if (safeSupport != null) {
      const label = supportTouches ? `S (${supportTouches}t)` : "S";
      supportLineRef.current = series.createPriceLine({
        price: safeSupport,
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: label,
      });
    }

    if (safeResistance != null) {
      const label = resistanceTouches ? `R (${resistanceTouches}t)` : "R";
      resistanceLineRef.current = series.createPriceLine({
        price: safeResistance,
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: label,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportLevel, resistanceLevel, supportTouches, resistanceTouches, chartReady, tick?.price]);

  // Today's frozen lines: S1–S3 (green), R1–R3 (red), fixed at the open.
  // A line already closed through today is drawn dotted and faded ("broken").
  const dayLevelsKey = dayLevels
    ? `${dayLevels.date}|${dayLevels.levels.map((l) => `${l.name}:${l.level}`).join(",")}|${dayLevels.broken.join(",")}`
    : "";
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;
    const series = candleSeriesRef.current;
    for (const line of dayLineRefs.current) series.removePriceLine(line);
    dayLineRefs.current = [];
    if (!dayLevels) return;
    for (const l of dayLevels.levels) {
      const broken = dayLevels.broken.includes(l.name);
      const support = l.kind === "SUPPORT";
      dayLineRefs.current.push(
        series.createPriceLine({
          price: l.level,
          color: support ? (broken ? "rgba(34,197,94,0.45)" : "#22c55e") : broken ? "rgba(239,68,68,0.45)" : "#ef4444",
          lineWidth: broken ? 1 : 2,
          lineStyle: broken ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: broken ? `${l.name} (broken)` : l.name,
        }),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayLevelsKey, chartReady]);

  // Fetch candle data + compute MAs
  const fetchCandles = useCallback(async () => {
    const cfg = INTERVAL_MAP[interval];
    if (!cfg) return;
    intervalSecondsRef.current = cfg.seconds;

    const days = daysProp ?? (cfg.api === "day" ? 90 : 1);

    try {
      const res = await fetch(
        `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/history?interval=${cfg.api}&days=${days}`
      );
      if (!res.ok) return;
      const json = await res.json();
      const candles: CandleData[] = json.candles || [];

      if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

      const candleData: CandlestickData<Time>[] = candles.map((c) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData: HistogramData<Time>[] = candles.map((c) => ({
        time: toChartTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      candleSeriesRef.current.setData(candleData);
      volumeSeriesRef.current.setData(volumeData);

      // Compute and set MA lines
      if (ma20SeriesRef.current && candles.length >= 20) {
        ma20SeriesRef.current.setData(computeMA(candles, 20));
      }
      if (ma50SeriesRef.current && candles.length >= 50) {
        ma50SeriesRef.current.setData(computeMA(candles, 50));
      }

      if (candles.length > 0) {
        lastCandleRef.current = candles[candles.length - 1];
      }

      // Show the LATEST candles at full width (one time label per candle);
      // scroll left for earlier ones. (fitContent would squeeze all 5 days in.)
      chartRef.current?.timeScale().applyOptions({ barSpacing: CANDLE_SPACING_PX });
      chartRef.current?.timeScale().scrollToRealTime();
    } catch {
      // ignore fetch errors
    }
  }, [symbol, interval, daysProp]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  // Real-time tick updates
  useEffect(() => {
    if (!tick || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const last = lastCandleRef.current;
    if (!last) return;

    const tickTime = Math.floor(tick.timestamp / 1000);
    const intervalSec = intervalSecondsRef.current;
    const candleStart = Math.floor(tickTime / intervalSec) * intervalSec;
    const lastCandleStart = Math.floor(last.time / intervalSec) * intervalSec;

    if (candleStart === lastCandleStart) {
      const updated: CandleData = {
        ...last,
        high: Math.max(last.high, tick.price),
        low: Math.min(last.low, tick.price),
        close: tick.price,
        volume: tick.volume ?? last.volume,
      };
      lastCandleRef.current = updated;

      candleSeriesRef.current.update({
        time: toChartTime(last.time),
        open: updated.open,
        high: updated.high,
        low: updated.low,
        close: updated.close,
      });
      volumeSeriesRef.current.update({
        time: toChartTime(last.time),
        value: updated.volume,
        color:
          updated.close >= updated.open
            ? "rgba(34,197,94,0.3)"
            : "rgba(239,68,68,0.3)",
      });
    } else if (candleStart > lastCandleStart) {
      const newCandle: CandleData = {
        time: candleStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume ?? 0,
      };
      lastCandleRef.current = newCandle;

      candleSeriesRef.current.update({
        time: toChartTime(candleStart),
        open: newCandle.open,
        high: newCandle.high,
        low: newCandle.low,
        close: newCandle.close,
      });
      volumeSeriesRef.current.update({
        time: toChartTime(candleStart),
        value: newCandle.volume,
        color: "rgba(34,197,94,0.3)",
      });
    }
  }, [tick]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
