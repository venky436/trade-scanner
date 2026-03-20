"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StockRow } from "./stock-row";
import type { StockData, SortKey, SortDirection } from "@/lib/types";

interface StockTableProps {
  stocks: StockData[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
}

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "price", label: "LTP", className: "text-right" },
  { key: "change", label: "Change%", className: "text-right" },
  { key: "open", label: "Open", className: "text-right" },
  { key: "high", label: "High", className: "text-right" },
  { key: "low", label: "Low", className: "text-right" },
  { key: "volume", label: "Volume", className: "text-right" },
];

export function StockTable({
  stocks,
  sortKey,
  sortDirection,
  onSort,
}: StockTableProps) {
  return (
    <div className="overflow-auto max-h-[calc(100vh-10rem)]">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="w-12 text-muted-foreground">#</TableHead>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className={`cursor-pointer select-none hover:text-foreground ${col.className || ""}`}
                onClick={() => onSort(col.key)}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1">
                    {sortDirection === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((stock, i) => (
            <StockRow key={stock.symbol} stock={stock} index={i} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
