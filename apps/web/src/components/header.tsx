"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

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
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm border-b border-border/50">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-4 px-4 h-14">
        {/* Left: Logo */}
        <a href="/" className="text-lg font-bold tracking-tight text-foreground shrink-0">
          TradeScanner
        </a>

        {/* Right: Search + Theme + Status */}
        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Search stocks..."
            className="max-w-xs h-8 text-sm"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />

          {mounted && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          )}

          {kiteConnected ? (
            <div className="flex items-center gap-2">
              <Badge
                variant={isConnected ? "default" : "destructive"}
                className="gap-1.5"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnected ? "bg-green-400 animate-pulse" : "bg-red-400"
                  }`}
                />
                {isConnected ? "LIVE" : "Disconnected"}
              </Badge>
              <Badge variant="secondary" className="tabular-nums">
                {stockCount}
              </Badge>
              {isConnected && (
                <a
                  href={`${API_URL}/api/auth/login`}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Re-login
                </a>
              )}
            </div>
          ) : (
            <a href={`${API_URL}/api/auth/login`}>
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5 border-yellow-500/50 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-500 dark:bg-yellow-400" />
                Connect Kite
              </Badge>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
