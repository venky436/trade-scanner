"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Sun, Moon, LogOut, TrendingUp } from "lucide-react";
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
        <a href="/" className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center size-8 rounded-lg bg-green-500/15">
            <TrendingUp className="size-4 text-green-500" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            TradeScanner
          </span>
        </a>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <Input
            type="search"
            placeholder="Search stocks..."
            className="max-w-xs h-8 text-sm"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />

          {/* Live / Connect badge */}
          {kiteConnected ? (
            <>
              <Badge
                variant={isConnected ? "outline" : "destructive"}
                className="gap-1.5 border-green-500/50"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnected ? "bg-green-500 animate-pulse" : "bg-red-400"
                  }`}
                />
                {isConnected ? "Live" : "Offline"}
              </Badge>

              <a href={`${API_URL}/api/auth/login`}>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Re-login
                </Button>
              </a>
            </>
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

          {/* Theme toggle */}
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

          {/* Admin link */}
          <Link
            href="/admin"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Admin
          </Link>

          {/* Logout icon (placeholder) */}
          <Button variant="ghost" size="icon-sm" aria-label="Logout">
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
