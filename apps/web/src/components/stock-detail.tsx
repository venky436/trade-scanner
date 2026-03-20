"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CandlestickChart } from "./candlestick-chart";
import { useMarketData } from "@/hooks/use-market-data";

const INTERVALS = ["1m", "5m", "15m", "30m", "1H", "1D"] as const;

function formatPrice(price: number): string {
  return price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + "M";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return vol.toLocaleString();
}

export function StockDetail({ symbol }: { symbol: string }) {
  const { stockMap } = useMarketData();
  const [interval, setInterval] = useState<string>("1m");

  const stock = stockMap.get(symbol) ?? null;

  const changeColor =
    stock && stock.change > 0
      ? "text-green-400"
      : stock && stock.change < 0
        ? "text-red-400"
        : "text-zinc-400";

  const changeSign = stock && stock.change > 0 ? "+" : "";

  // Day range calculation
  const dayRangePercent =
    stock && stock.high > stock.low
      ? ((stock.price - stock.low) / (stock.high - stock.low)) * 100
      : 50;

  return (
    <main className="p-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl font-bold">{symbol}</h1>
            {stock && (
              <>
                <span className="text-2xl font-mono tabular-nums">
                  {formatPrice(stock.price)}
                </span>
                <span className={`text-lg font-mono tabular-nums ${changeColor}`}>
                  {changeSign}
                  {stock.change.toFixed(2)}%
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground">MCX &middot; Commodity</p>
        </div>
      </div>

      {/* Chart */}
      <Card className="border-border/50 mb-4">
        <CardContent className="p-4">
          <div className="h-[500px]">
            <CandlestickChart
              symbol={symbol}
              interval={interval}
              tick={stock}
            />
          </div>

          {/* Interval Selector */}
          <div className="flex gap-2 mt-4">
            {INTERVALS.map((iv) => (
              <Button
                key={iv}
                variant={interval === iv ? "default" : "outline"}
                size="sm"
                onClick={() => setInterval(iv)}
              >
                {iv}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      {stock && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <StatCard label="Open" value={formatPrice(stock.open)} />
          <StatCard label="High" value={formatPrice(stock.high)} />
          <StatCard label="Low" value={formatPrice(stock.low)} />
          <StatCard label="Close" value={formatPrice(stock.close)} />
          <StatCard label="Volume" value={formatVolume(stock.volume)} />
          <StatCard
            label="Change"
            value={`${changeSign}${stock.change.toFixed(2)}%`}
            valueClass={changeColor}
          />
        </div>
      )}

      {/* Day Range */}
      {stock && (
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
              <span>Day Range</span>
              <span>
                {formatPrice(stock.low)} &mdash; {formatPrice(stock.high)}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-zinc-800">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-green-500"
                style={{ width: `${Math.min(Math.max(dayRangePercent, 0), 100)}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-zinc-900"
                style={{
                  left: `${Math.min(Math.max(dayRangePercent, 0), 100)}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-lg font-mono tabular-nums ${valueClass || ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
