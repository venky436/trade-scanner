"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface HeaderProps {
  isConnected: boolean;
  kiteConnected: boolean;
  stockCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export function Header({
  isConnected,
  kiteConnected,
  stockCount,
  searchQuery,
  onSearchChange,
}: HeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Trading Scanner</h1>
        {kiteConnected ? (
          <>
            <Badge
              variant={isConnected ? "default" : "destructive"}
              className="gap-1.5"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isConnected ? "bg-green-400 animate-pulse" : "bg-red-400"
                }`}
              />
              {isConnected ? "Live" : "Disconnected"}
            </Badge>
            <Badge variant="secondary">{stockCount} stocks</Badge>
          </>
        ) : (
          <a href={`${API_URL}/api/auth/login`}>
            <Badge
              variant="outline"
              className="cursor-pointer gap-1.5 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 transition-colors"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
              Connect Kite
            </Badge>
          </a>
        )}
      </div>
      <Input
        type="search"
        placeholder="Search symbol..."
        className="max-w-xs"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
  );
}
