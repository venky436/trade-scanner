"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type IPriceLine,
} from "lightweight-charts";
import type { CandleData, StockData } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

// Map interval button labels to API interval values
const INTERVAL_MAP: Record<string, { api: string; seconds: number }> = {
  "1m": { api: "minute", seconds: 60 },
  "5m": { api: "5minute", seconds: 300 },
  "15m": { api: "15minute", seconds: 900 },
  "30m": { api: "30minute", seconds: 1800 },
  "1H": { api: "60minute", seconds: 3600 },
  "1D": { api: "day", seconds: 86400 },
};

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  tick: StockData | null;
  days?: number;
  supportLevel?: number | null;
  resistanceLevel?: number | null;
  className?: string;
}

export function CandlestickChart({
  symbol,
  interval,
  tick,
  days: daysProp,
  supportLevel,
  resistanceLevel,
  className,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      supportLineRef.current = null;
      resistanceLineRef.current = null;
      setChartReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update chart theme when resolvedTheme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const colors = getThemeColors(resolvedTheme);
    chartRef.current.applyOptions({
      layout: {
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: {
        borderColor: colors.border,
      },
      timeScale: {
        borderColor: colors.border,
      },
    });
  }, [resolvedTheme, getThemeColors]);

  // Draw S/R price lines
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;

    // Remove old lines
    if (supportLineRef.current) {
      candleSeriesRef.current.removePriceLine(supportLineRef.current);
      supportLineRef.current = null;
    }
    if (resistanceLineRef.current) {
      candleSeriesRef.current.removePriceLine(resistanceLineRef.current);
      resistanceLineRef.current = null;
    }

    // Draw support line
    if (supportLevel != null) {
      supportLineRef.current = candleSeriesRef.current.createPriceLine({
        price: supportLevel,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "S",
      });
    }

    // Draw resistance line
    if (resistanceLevel != null) {
      resistanceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: resistanceLevel,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "R",
      });
    }
  }, [supportLevel, resistanceLevel, chartReady]);

  // Fetch data when symbol, interval, or days changes
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
    const candleStart =
      Math.floor(tickTime / intervalSec) * intervalSec;
    const lastCandleStart =
      Math.floor(last.time / intervalSec) * intervalSec;

    if (candleStart === lastCandleStart) {
      // Update existing candle
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
      // New candle
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
