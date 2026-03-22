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
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type IPriceLine,
} from "lightweight-charts";
import type { CandleData, StockData } from "@/lib/types";

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
    result.push({ time: candles[i].time as Time, value: sum / period });
  }
  return result;
}

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  tick: StockData | null;
  days?: number;
  supportLevel?: number | null;
  resistanceLevel?: number | null;
  supportTouches?: number;
  resistanceTouches?: number;
  className?: string;
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
      },
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

  // Draw S/R price lines
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    if (supportLineRef.current) { series.removePriceLine(supportLineRef.current); supportLineRef.current = null; }
    if (resistanceLineRef.current) { series.removePriceLine(resistanceLineRef.current); resistanceLineRef.current = null; }

    if (supportLevel != null) {
      const label = supportTouches ? `S (${supportTouches}t)` : "S";
      supportLineRef.current = series.createPriceLine({
        price: supportLevel,
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: label,
      });
    }

    if (resistanceLevel != null) {
      const label = resistanceTouches ? `R (${resistanceTouches}t)` : "R";
      resistanceLineRef.current = series.createPriceLine({
        price: resistanceLevel,
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: label,
      });
    }
  }, [supportLevel, resistanceLevel, supportTouches, resistanceTouches, chartReady]);

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
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData: HistogramData<Time>[] = candles.map((c) => ({
        time: c.time as Time,
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

      chartRef.current?.timeScale().fitContent();
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
        volume: tick.volume,
      };
      lastCandleRef.current = updated;

      candleSeriesRef.current.update({
        time: last.time as Time,
        open: updated.open,
        high: updated.high,
        low: updated.low,
        close: updated.close,
      });
      volumeSeriesRef.current.update({
        time: last.time as Time,
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
        volume: tick.volume,
      };
      lastCandleRef.current = newCandle;

      candleSeriesRef.current.update({
        time: candleStart as Time,
        open: newCandle.open,
        high: newCandle.high,
        low: newCandle.low,
        close: newCandle.close,
      });
      volumeSeriesRef.current.update({
        time: candleStart as Time,
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
