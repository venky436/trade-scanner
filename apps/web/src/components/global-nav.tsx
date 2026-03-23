"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon, LogOut, TrendingUp, Search, X, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import { useEffect, useRef, useState, useCallback } from "react";
import { INDEX_NAMES } from "@/lib/constants";
import { apiFetch, API_URL } from "@/lib/api";

interface SearchResult {
  symbol: string;
  price: number;
  change: number;
  isTracked: boolean;
}

export function GlobalNav() {
  const { stockMap, isConnected } = useMarketData();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [kiteConnected, setKiteConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setMounted(true), []);

  // Poll auth status
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const res = await apiFetch("/api/auth/status");
        const data = await res.json();
        if (active) setKiteConnected(data.connected);
      } catch { /* ignore */ }
    }
    check();
    const interval = setInterval(check, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (stockMap.size > 0) setKiteConnected(true);
  }, [stockMap.size]);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    try {
      const res = await apiFetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results ?? []);
      setShowResults(true);
      setSelectedIndex(-1);
    } catch {
      // ignore
    }
  }, []);

  function handleInputChange(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function handleSelect(symbol: string) {
    setSearchQuery("");
    setResults([]);
    setShowResults(false);
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setShowResults(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && selectedIndex >= 0 && results[selectedIndex]) {
      handleSelect(results[selectedIndex].symbol);
    }
  }

  const stockCount = Array.from(stockMap.values()).filter((s) => !INDEX_NAMES.has(s.symbol)).length;

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b border-border/50">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-4 px-4 h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center size-8 rounded-lg bg-green-500/15">
            <TrendingUp className="size-4 text-green-500" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground hidden sm:block">
            TradeScanner
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div ref={searchRef} className="relative flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search any stock..."
              value={searchQuery}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => results.length > 0 && setShowResults(true)}
              onKeyDown={handleKeyDown}
              className="w-full h-9 pl-9 pr-8 text-sm bg-muted/50 border border-border/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50 placeholder:text-muted-foreground/40 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setResults([]); setShowResults(false); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Results dropdown */}
          {showResults && results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-card/95 backdrop-blur-xl border border-border/30 rounded-xl shadow-2xl shadow-black/20 overflow-hidden z-50">
              {results.map((r, i) => {
                const positive = r.change >= 0;
                return (
                  <button
                    key={r.symbol}
                    onClick={() => handleSelect(r.symbol)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                      i === selectedIndex ? "bg-muted/60" : "hover:bg-muted/40"
                    } ${i > 0 ? "border-t border-border/10" : ""}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-foreground">{r.symbol}</span>
                      {r.isTracked ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">LIVE</span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">ON-DEMAND</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.price > 0 && (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          ₹{r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </span>
                      )}
                      {r.change !== 0 && (
                        <span className={`font-mono text-[11px] tabular-nums ${positive ? "text-green-500" : "text-red-500"}`}>
                          {positive ? "+" : ""}{r.change.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* No results */}
          {showResults && results.length === 0 && searchQuery.length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-card/95 backdrop-blur-xl border border-border/30 rounded-xl shadow-2xl shadow-black/20 p-4 text-center text-sm text-muted-foreground z-50">
              No stocks found for &quot;{searchQuery}&quot;
            </div>
          )}
        </div>

          {/* Live status — show market phase context */}
          {kiteConnected ? (() => {
            const now = new Date();
            const hour = now.getHours();
            const min = now.getMinutes();
            const time = hour * 60 + min;
            const day = now.getDay();
            const openMin = 9 * 60 + 15; // 9:15 AM
            const closeMin = 15 * 60 + 30; // 3:30 PM
            const isWeekday = day >= 1 && day <= 5;
            const isMarketHours = isWeekday && time >= openMin && time <= closeMin;

            if (!isMarketHours) {
              return (
                <Badge variant="outline" className="gap-1.5 border-zinc-500/50 text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
                  Market Closed
                </Badge>
              );
            }

            const elapsed = time - openMin;

            // OPENING phase: 0-5 min
            if (elapsed < 5) {
              return (
                <Badge variant="outline" className="gap-1.5 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                  Opening ({5 - elapsed}m)
                </Badge>
              );
            }

            // STABILIZING phase: 5-10 min
            if (elapsed < 10) {
              return (
                <Badge variant="outline" className="gap-1.5 border-orange-500/50 text-orange-600 dark:text-orange-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                  Stabilizing ({10 - elapsed}m)
                </Badge>
              );
            }

            // NORMAL phase
            return (
              <Badge variant="outline" className="gap-1.5 border-green-500/50">
                <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-400"}`} />
                {isConnected ? "Live" : "Offline"}
              </Badge>
            );
          })() : (
            <a href={`${API_URL}/api/auth/login`}>
              <Badge variant="outline" className="cursor-pointer gap-1.5 border-yellow-500/50 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors">
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-500 dark:bg-yellow-400" />
                Connect Kite
              </Badge>
            </a>
          )}

          {/* Admin only: Re-login + Admin icon */}
          {user?.role === "ADMIN" && (
            <>
              {kiteConnected && (
                <a href={`${API_URL}/api/auth/login`}>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground">
                    Re-login
                  </Button>
                </a>
              )}
              <Link href="/admin">
                <Button variant="ghost" size="icon-sm" aria-label="Admin Dashboard" className="text-muted-foreground hover:text-foreground">
                  <Shield className="size-4" />
                </Button>
              </Link>
            </>
          )}

          {/* Theme toggle */}
          {mounted && (
            <Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          )}

          {/* User + Logout */}
          <div className="flex items-center gap-2 pl-1 border-l border-border/30">
            {user && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                {user.name || user.email.split("@")[0]}
              </span>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Logout" onClick={logout} className="text-muted-foreground hover:text-red-500">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
