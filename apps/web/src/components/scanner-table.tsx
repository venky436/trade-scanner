"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScannerRow } from "./scanner-row";
import type { StockData, SignalConfidence, MomentumSignal } from "@/lib/types";

type ScannerSortKey = "symbol" | "price" | "change" | "signal" | "confidence" | "momentum";

interface ScannerTableProps {
  stocks: StockData[];
}

const SIGNAL_PRIORITY: Record<string, number> = { BUY: 2, SELL: 2, WAIT: 1 };
const CONFIDENCE_PRIORITY: Record<SignalConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const MOMENTUM_PRIORITY: Record<MomentumSignal, number> = {
  STRONG_UP: 0,
  UP: 1,
  FLAT: 2,
  DOWN: 3,
  STRONG_DOWN: 4,
};

const COLUMNS: { key: ScannerSortKey; label: string; className?: string; sortable?: boolean }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "price", label: "Price", className: "text-right" },
  { key: "change", label: "Change", className: "text-right" },
  { key: "signal", label: "Signal", className: "text-center" },
  { key: "symbol", label: "Type", className: "text-center", sortable: false },
  { key: "confidence", label: "Confidence", className: "text-center" },
  { key: "momentum", label: "Momentum", className: "text-center" },
];

function getSignalPriority(s: StockData): number {
  return SIGNAL_PRIORITY[s.signal?.action ?? "WAIT"] ?? 1;
}

function getConfidencePriority(s: StockData): number {
  return CONFIDENCE_PRIORITY[s.signal?.confidence ?? "LOW"] ?? 2;
}

function getMomentumPriority(s: StockData): number {
  return MOMENTUM_PRIORITY[s.momentum?.signal ?? "FLAT"] ?? 2;
}

export function ScannerTable({ stocks }: ScannerTableProps) {
  const [sortKey, setSortKey] = useState<ScannerSortKey>("signal");
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = useCallback(
    (key: ScannerSortKey) => {
      if (key === sortKey) {
        setSortAsc((v) => !v);
      } else {
        setSortKey(key);
        setSortAsc(true);
      }
    },
    [sortKey]
  );

  const sorted = useMemo(() => {
    const arr = [...stocks];
    arr.sort((a, b) => {
      let diff = 0;

      switch (sortKey) {
        case "symbol":
          diff = a.symbol.localeCompare(b.symbol);
          break;
        case "price":
          diff = a.price - b.price;
          break;
        case "change":
          diff = a.change - b.change;
          break;
        case "signal":
          diff = getSignalPriority(b) - getSignalPriority(a);
          if (diff === 0) diff = getConfidencePriority(a) - getConfidencePriority(b);
          if (diff === 0) diff = getMomentumPriority(a) - getMomentumPriority(b);
          break;
        case "confidence":
          diff = getConfidencePriority(a) - getConfidencePriority(b);
          break;
        case "momentum":
          diff = getMomentumPriority(a) - getMomentumPriority(b);
          break;
      }

      return sortAsc ? diff : -diff;
    });
    return arr;
  }, [stocks, sortKey, sortAsc]);

  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground rounded-xl border border-border/50 bg-card/50">
        <Search className="size-8 mb-3 text-muted-foreground/30" />
        <p className="text-sm font-medium">No stocks match the current filter</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Try adjusting your filters or search query
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-card/50 backdrop-blur-sm shadow-sm">
      <div className="overflow-auto max-h-[calc(100vh-26rem)]">
        <Table>
          <TableHeader className="sticky top-0 bg-card/95 backdrop-blur-sm z-10 border-b border-border/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="w-10 text-muted-foreground">#</TableHead>
              {COLUMNS.map((col, i) => {
                const sortable = col.sortable !== false;
                return (
                  <TableHead
                    key={`${col.key}-${i}`}
                    className={`${
                      sortable
                        ? "cursor-pointer select-none hover:text-foreground transition-colors"
                        : ""
                    } ${col.className || ""}`}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortable && sortKey === col.key && (
                        <span className="text-primary text-[10px]">
                          {sortAsc ? "▲" : "▼"}
                        </span>
                      )}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((stock, i) => (
              <ScannerRow key={stock.symbol} stock={stock} index={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
