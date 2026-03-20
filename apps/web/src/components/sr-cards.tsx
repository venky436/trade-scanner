"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockData, SupportResistanceResult, Reaction, DirectionHint } from "@/lib/types";

interface SRCardsProps {
  stockMap: Map<string, StockData>;
  levels: Record<string, SupportResistanceResult>;
}

interface RankedStock {
  symbol: string;
  price: number;
  level: number;
  distancePercent: number;
  reaction: Reaction;
  directionHint: DirectionHint;
  isActionable: boolean;
}

export function SRCards({ stockMap, levels }: SRCardsProps) {
  const { nearResistance, nearSupport } = useMemo(() => {
    const resistance: RankedStock[] = [];
    const support: RankedStock[] = [];

    for (const [symbol, sr] of Object.entries(levels)) {
      const stock = stockMap.get(symbol);
      const price = stock?.price ?? 0;
      if (price <= 0) continue;

      if (sr.resistance !== null && sr.resistanceZone) {
        const dist = ((sr.resistance - price) / price) * 100;
        if (dist > 0) {
          resistance.push({
            symbol,
            price,
            level: sr.resistance,
            distancePercent: dist,
            reaction: sr.resistanceZone.reaction,
            directionHint: sr.resistanceZone.directionHint,
            isActionable: sr.resistanceZone.isActionable,
          });
        }
      }

      if (sr.support !== null && sr.supportZone) {
        const dist = ((price - sr.support) / price) * 100;
        if (dist > 0) {
          support.push({
            symbol,
            price,
            level: sr.support,
            distancePercent: dist,
            reaction: sr.supportZone.reaction,
            directionHint: sr.supportZone.directionHint,
            isActionable: sr.supportZone.isActionable,
          });
        }
      }
    }

    // Sort by distance ascending (closest first), take top 3
    resistance.sort((a, b) => a.distancePercent - b.distancePercent);
    support.sort((a, b) => a.distancePercent - b.distancePercent);

    return {
      nearResistance: resistance.slice(0, 3),
      nearSupport: support.slice(0, 3),
    };
  }, [stockMap, levels]);

  if (nearResistance.length === 0 && nearSupport.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <SRCard
        title="Near Resistance"
        items={nearResistance}
        color="red"
        labelPrefix="R"
      />
      <SRCard
        title="Near Support"
        items={nearSupport}
        color="green"
        labelPrefix="S"
      />
    </div>
  );
}

function SRCard({
  title,
  items,
  color,
  labelPrefix,
}: {
  title: string;
  items: RankedStock[];
  color: "red" | "green";
  labelPrefix: string;
}) {
  const router = useRouter();
  const dotColor = color === "red" ? "bg-red-400" : "bg-green-400";
  const levelColor = color === "red" ? "text-red-400" : "text-green-400";

  return (
    <Card className="border-border/50" size="sm">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No stocks nearby</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div
                key={item.symbol}
                className="flex items-center justify-between cursor-pointer rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50 transition-colors"
                onClick={() =>
                  router.push(`/stock/${encodeURIComponent(item.symbol)}`)
                }
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.symbol}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.price.toFixed(2)}
                  </span>
                  <ReactionBadge reaction={item.reaction} />
                </div>
                <div className="text-right flex items-center gap-1.5">
                  <DirectionArrow hint={item.directionHint} />
                  <span className={`text-xs font-mono ${levelColor}`}>
                    {labelPrefix}: {item.level.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    ({item.distancePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReactionBadge({ reaction }: { reaction: Reaction }) {
  if (reaction === "NEUTRAL") return null;
  const isApproaching = reaction === "APPROACHING";
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
        isApproaching
          ? "bg-yellow-500/15 text-yellow-400"
          : "bg-blue-500/15 text-blue-400"
      }`}
    >
      {isApproaching ? "APPROACHING" : "REJECTING"}
    </span>
  );
}

function DirectionArrow({ hint }: { hint: DirectionHint }) {
  if (hint === "NEUTRAL") return null;
  const isBullish = hint === "BULLISH";
  return (
    <span className={`text-xs ${isBullish ? "text-green-400" : "text-red-400"}`}>
      {isBullish ? "\u25B2" : "\u25BC"}
    </span>
  );
}
