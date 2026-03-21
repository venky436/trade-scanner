"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockData, SupportResistanceResult, PressureSignal } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface ScannerDashboardProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
}

interface SRRow {
  symbol: string;
  price: number;
  level: number;
  distancePercent: number;
  pressureSignal?: PressureSignal;
  zoneScore: number;
}

interface VolumeRow {
  symbol: string;
  price: number;
  volumeRatio: number;
}

export function ScannerDashboard({ stockMap, srLevels }: ScannerDashboardProps) {
  const { nearSupport, nearResistance, volumeSpike } = useMemo(() => {
    const support: SRRow[] = [];
    const resistance: SRRow[] = [];

    for (const [symbol, sr] of Object.entries(srLevels)) {
      const stock = stockMap.get(symbol);
      if (!stock || stock.price <= 0 || INDEX_NAMES.has(symbol)) continue;

      if (sr.summary.hasNearbySupport && sr.support !== null && sr.supportZone) {
        const dist = ((stock.price - sr.support) / stock.price) * 100;
        if (dist >= 0) {
          support.push({
            symbol,
            price: stock.price,
            level: sr.support,
            distancePercent: dist,
            pressureSignal: stock.pressure?.signal,
            zoneScore: sr.supportZone.zoneScore,
          });
        }
      }

      if (sr.summary.hasNearbyResistance && sr.resistance !== null && sr.resistanceZone) {
        const dist = ((sr.resistance - stock.price) / stock.price) * 100;
        if (dist >= 0) {
          resistance.push({
            symbol,
            price: stock.price,
            level: sr.resistance,
            distancePercent: dist,
            pressureSignal: stock.pressure?.signal,
            zoneScore: sr.resistanceZone.zoneScore,
          });
        }
      }
    }

    support.sort((a, b) => a.distancePercent - b.distancePercent);
    resistance.sort((a, b) => a.distancePercent - b.distancePercent);

    // Volume spike: compute median volume, filter > 1.5x
    const stocks = Array.from(stockMap.values()).filter(
      (s) => !INDEX_NAMES.has(s.symbol) && s.volume > 0
    );
    const volumes = stocks.map((s) => s.volume).sort((a, b) => a - b);
    const medianVolume =
      volumes.length > 0
        ? volumes.length % 2 === 0
          ? (volumes[volumes.length / 2 - 1] + volumes[volumes.length / 2]) / 2
          : volumes[Math.floor(volumes.length / 2)]
        : 1;

    const volSpike: VolumeRow[] = stocks
      .map((s) => ({
        symbol: s.symbol,
        price: s.price,
        volumeRatio: medianVolume > 0 ? s.volume / medianVolume : 0,
      }))
      .filter((v) => v.volumeRatio > 1.5)
      .sort((a, b) => b.volumeRatio - a.volumeRatio)
      .slice(0, 5);

    return {
      nearSupport: support.slice(0, 5),
      nearResistance: resistance.slice(0, 5),
      volumeSpike: volSpike,
    };
  }, [stockMap, srLevels]);

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        Scanner Dashboard
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Real-time stock screening across multiple signals
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SupportTable rows={nearSupport} />
        <ResistanceTable rows={nearResistance} />
        <VolumeTable rows={volumeSpike} />
      </div>
    </div>
  );
}

function SupportTable({ rows }: { rows: SRRow[] }) {
  const router = useRouter();
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
          Stocks Near Support
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No stocks nearby</p>
        ) : (
          <div className="space-y-0">
            <div className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(60px,auto)_minmax(48px,auto)] gap-x-3 text-[10px] font-semibold uppercase text-muted-foreground pb-1 border-b border-border/50">
              <span>Sym</span>
              <span className="text-right">Price</span>
              <span className="text-right">Support</span>
              <span className="text-right">Dist</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.symbol}
                className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(60px,auto)_minmax(48px,auto)] gap-x-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 rounded -mx-1 px-1 transition-colors"
                onClick={() =>
                  router.push(`/stock/${encodeURIComponent(row.symbol)}`)
                }
              >
                <span className="font-medium text-foreground">{row.symbol}</span>
                <span className="text-right font-mono tabular-nums">
                  {row.price.toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums text-green-600 dark:text-green-400">
                  {row.level.toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums text-muted-foreground">
                  {row.distancePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResistanceTable({ rows }: { rows: SRRow[] }) {
  const router = useRouter();
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
          Stocks Near Resistance
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No stocks nearby</p>
        ) : (
          <div className="space-y-0">
            <div className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(60px,auto)_minmax(48px,auto)] gap-x-3 text-[10px] font-semibold uppercase text-muted-foreground pb-1 border-b border-border/50">
              <span>Sym</span>
              <span className="text-right">Price</span>
              <span className="text-right">Resist</span>
              <span className="text-right">Dist</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.symbol}
                className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(60px,auto)_minmax(48px,auto)] gap-x-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 rounded -mx-1 px-1 transition-colors"
                onClick={() =>
                  router.push(`/stock/${encodeURIComponent(row.symbol)}`)
                }
              >
                <span className="font-medium text-foreground">{row.symbol}</span>
                <span className="text-right font-mono tabular-nums">
                  {row.price.toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                  {row.level.toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums text-muted-foreground">
                  {row.distancePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VolumeTable({ rows }: { rows: VolumeRow[] }) {
  const router = useRouter();
  const maxRatio = rows.length > 0 ? Math.max(...rows.map((r) => r.volumeRatio)) : 1;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-orange-400" />
          Volume Spike
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No volume spikes</p>
        ) : (
          <div className="space-y-0">
            <div className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(80px,auto)] gap-x-3 text-[10px] font-semibold uppercase text-muted-foreground pb-1 border-b border-border/50">
              <span>Sym</span>
              <span className="text-right">Price</span>
              <span className="text-right">Vol Ratio</span>
            </div>
            {rows.map((row) => {
              const barWidth = Math.min(100, (row.volumeRatio / maxRatio) * 100);
              return (
                <div
                  key={row.symbol}
                  className="grid grid-cols-[1fr_minmax(60px,auto)_minmax(80px,auto)] gap-x-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 rounded -mx-1 px-1 transition-colors"
                  onClick={() =>
                    router.push(`/stock/${encodeURIComponent(row.symbol)}`)
                  }
                >
                  <span className="font-medium text-foreground">{row.symbol}</span>
                  <span className="text-right font-mono tabular-nums">
                    {row.price.toFixed(2)}
                  </span>
                  <div className="flex items-center gap-1.5 justify-end">
                    <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-400 to-red-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="font-mono tabular-nums text-orange-500 min-w-[3ch] text-right">
                      {row.volumeRatio.toFixed(1)}x
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
