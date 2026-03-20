"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function StockTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/50 hover:bg-transparent">
          <TableHead className="w-12">#</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">LTP</TableHead>
          <TableHead className="text-right">Change%</TableHead>
          <TableHead className="text-right">Open</TableHead>
          <TableHead className="text-right">High</TableHead>
          <TableHead className="text-right">Low</TableHead>
          <TableHead className="text-right">Volume</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 15 }, (_, i) => (
          <TableRow key={i} className="border-border/50">
            <TableCell>
              <Skeleton className="h-4 w-6" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-20 ml-auto" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-16 ml-auto" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-20 ml-auto" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-20 ml-auto" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-20 ml-auto" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="h-4 w-16 ml-auto" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
