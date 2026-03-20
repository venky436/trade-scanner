"use client";

import { memo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TableCell, TableRow } from "@/components/ui/table";
import type { StockData } from "@/lib/types";
import { FLASH_DURATION_MS } from "@/lib/constants";

interface StockRowProps {
  stock: StockData;
  index: number;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + "M";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return vol.toLocaleString();
}

function StockRowInner({ stock, index }: StockRowProps) {
  const router = useRouter();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const prevPriceRef = useRef<number>(stock.price);

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

  const changeColor =
    stock.change > 0
      ? "text-green-400"
      : stock.change < 0
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <TableRow
      ref={rowRef}
      className="border-border/50 hover:bg-muted/50 cursor-pointer"
      onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
    >
      <TableCell className="text-muted-foreground w-12">{index + 1}</TableCell>
      <TableCell className="font-medium">{stock.symbol}</TableCell>
      <TableCell className="font-mono tabular-nums text-right">
        {stock.price.toFixed(2)}
      </TableCell>
      <TableCell className={`font-mono tabular-nums text-right ${changeColor}`}>
        {stock.change > 0 ? "+" : ""}
        {stock.change.toFixed(2)}%
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right">
        {stock.open.toFixed(2)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right">
        {stock.high.toFixed(2)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right">
        {stock.low.toFixed(2)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right">
        {formatVolume(stock.volume)}
      </TableCell>
    </TableRow>
  );
}

export const StockRow = memo(StockRowInner, (prev, next) => {
  return (
    prev.stock.price === next.stock.price &&
    prev.stock.change === next.stock.change &&
    prev.stock.volume === next.stock.volume &&
    prev.stock.high === next.stock.high &&
    prev.stock.low === next.stock.low &&
    prev.index === next.index
  );
});
