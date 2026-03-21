"use client";

import { memo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  Flame,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { StockData } from "@/lib/types";
import { FLASH_DURATION_MS } from "@/lib/constants";

interface ScannerRowProps {
  stock: StockData;
  index: number;
}

const MOMENTUM_DISPLAY: Record<
  string,
  { label: string; className: string; bg: string }
> = {
  STRONG_UP: {
    label: "↑↑",
    className: "text-green-600 dark:text-green-400 font-bold",
    bg: "bg-green-500/10",
  },
  UP: {
    label: "↑",
    className: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
  },
  FLAT: {
    label: "→",
    className: "text-muted-foreground",
    bg: "bg-muted",
  },
  DOWN: {
    label: "↓",
    className: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
  },
  STRONG_DOWN: {
    label: "↓↓",
    className: "text-red-600 dark:text-red-400 font-bold",
    bg: "bg-red-500/10",
  },
};

const SIGNAL_TYPE_ICONS: Record<string, LucideIcon> = {
  BOUNCE: ArrowUpFromLine,
  REJECTION: ArrowDownToLine,
  BREAKOUT: Flame,
  BREAKDOWN: TrendingDown,
};

function ScannerRowInner({ stock, index }: ScannerRowProps) {
  const router = useRouter();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const prevPriceRef = useRef<number>(stock.price);

  // Flash on price change
  useEffect(() => {
    const prev = prevPriceRef.current;
    prevPriceRef.current = stock.price;

    if (prev === stock.price || prev === 0) return;

    const row = rowRef.current;
    if (!row) return;

    const direction = stock.price > prev ? "up" : "down";
    row.setAttribute("data-flash", direction);

    const timer = setTimeout(() => {
      row.removeAttribute("data-flash");
    }, FLASH_DURATION_MS);

    return () => clearTimeout(timer);
  }, [stock.price]);

  const positive = stock.change >= 0;
  const changeColor =
    stock.change > 0
      ? "text-green-600 dark:text-green-400"
      : stock.change < 0
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  const signal = stock.signal;
  const momentum = stock.momentum;
  const mom = momentum ? MOMENTUM_DISPLAY[momentum.signal] : null;

  return (
    <TableRow
      ref={rowRef}
      className="border-border/30 hover:bg-muted/40 cursor-pointer transition-colors duration-150"
      onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
    >
      {/* # */}
      <TableCell className="text-muted-foreground text-xs w-10">
        {index + 1}
      </TableCell>

      {/* Symbol */}
      <TableCell className="font-medium">{stock.symbol}</TableCell>

      {/* Price */}
      <TableCell className="font-mono tabular-nums text-right">
        ₹{stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </TableCell>

      {/* Change */}
      <TableCell
        className={`font-mono tabular-nums text-right text-xs ${changeColor}`}
      >
        {positive ? "+" : ""}
        {stock.change.toFixed(2)}%
      </TableCell>

      {/* Signal */}
      <TableCell className="text-center">
        {signal ? (
          signal.action !== "WAIT" ? (
            <span
              className={`inline-flex items-center justify-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${
                signal.action === "BUY"
                  ? "bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
                  : "bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/20"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  signal.action === "BUY" ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {signal.action}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">WAIT</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground/40">--</span>
        )}
      </TableCell>

      {/* Type */}
      <TableCell className="text-center">
        {signal?.type ? (
          <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {(() => {
              const Icon = SIGNAL_TYPE_ICONS[signal.type];
              return Icon ? <Icon className="size-3" /> : null;
            })()}
            <span>
              {signal.type.charAt(0) + signal.type.slice(1).toLowerCase()}
            </span>
          </div>
        ) : signal && signal.action !== "WAIT" ? (
          <span className="text-xs text-muted-foreground/50">
            {positive ? "Bullish" : "Bearish"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/40">--</span>
        )}
      </TableCell>

      {/* Confidence */}
      <TableCell className="text-center">
        {signal ? (
          <div className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                signal.confidence === "HIGH"
                  ? "bg-green-500"
                  : signal.confidence === "MEDIUM"
                    ? "bg-yellow-500"
                    : "bg-zinc-400"
              }`}
            />
            <span
              className={`text-xs font-medium ${
                signal.confidence === "HIGH"
                  ? "text-green-600 dark:text-green-400"
                  : signal.confidence === "MEDIUM"
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-muted-foreground"
              }`}
            >
              {signal.confidence}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40">--</span>
        )}
      </TableCell>

      {/* Momentum */}
      <TableCell className="text-center">
        {mom ? (
          <span
            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${mom.bg} ${mom.className}`}
          >
            {mom.label}
          </span>
        ) : stock.change !== 0 ? (
          <span
            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs ${
              positive
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {positive ? "↑" : "↓"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">→</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export const ScannerRow = memo(ScannerRowInner, (prev, next) => {
  return (
    prev.stock.price === next.stock.price &&
    prev.stock.change === next.stock.change &&
    prev.stock.signal?.action === next.stock.signal?.action &&
    prev.stock.signal?.confidence === next.stock.signal?.confidence &&
    prev.stock.momentum?.signal === next.stock.momentum?.signal &&
    prev.index === next.index
  );
});
