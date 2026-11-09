"use client";

// Cumulative P&L after each closed trade (lightweight-charts area series).
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { AreaSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";

export function EquityChart({ points }: { points: { time: number; pnl: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  useEffect(() => {
    if (!ref.current) return;
    const final = points.at(-1)?.pnl ?? 0;
    const line = final >= 0 ? "#10b981" : "#f43f5e";

    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#52525b",
        fontFamily: "var(--font-sans)",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: isDark ? "#27272a" : "#e4e4e7" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: true } },
      localization: { priceFormatter: (p: number) => `₹${p.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: line,
      lineWidth: 2,
      topColor: `${line}40`,
      bottomColor: `${line}05`,
      priceLineVisible: false,
    });

    // lightweight-charts needs strictly increasing times; IST shift so the axis reads local time
    const IST = 330 * 60;
    let prev = 0;
    const data = points.map((p) => {
      let t = p.time + IST;
      if (t <= prev) t = prev + 1;
      prev = t;
      return { time: t as UTCTimestamp, value: p.pnl };
    });
    series.setData(data);
    series.createPriceLine({ price: 0, color: isDark ? "#52525b" : "#a1a1aa", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points, isDark]);

  return <div ref={ref} className="h-64 w-full" aria-label="Cumulative profit and loss chart" role="img" />;
}
