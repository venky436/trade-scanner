import { Info } from "lucide-react";

// Global SEBI-safe disclaimer footer. Renders site-wide via the root AppShell so
// every public page (home, detail, admin) carries the same notice.
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-950/40">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-start gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800/80">
            <Info className="size-3.5 text-zinc-500 dark:text-zinc-400" />
          </div>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-3xl">
            This platform provides market analytics and educational insights based on real-time market conditions. Not investment advice or trade recommendations.
          </p>
        </div>
      </div>
    </footer>
  );
}
