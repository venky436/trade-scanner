"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Eye,
  Gauge,
  LayoutGrid,
  Sparkles,
  Target,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";

// Public marketing landing page. Renders for unauthenticated visitors at "/"
// to introduce the platform's core observation metrics. Once a visitor signs
// in, AppShell swaps in the actual Dashboard at the same URL.
//
// Design intent: a single-screen first impression that communicates four
// things — momentum, pressure, volatility, and zones — through subtle live
// motion (fade-ins, animated strength bars, hover lifts) without screaming
// "trading platform". Reads as a market-analytics tool.
export function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      {/* Decorative background gradients */}
      <div className="pointer-events-none absolute -top-40 -right-32 size-[40rem] rounded-full blur-3xl bg-cyan-400/10 dark:bg-cyan-500/8" />
      <div className="pointer-events-none absolute -bottom-40 -left-32 size-[40rem] rounded-full blur-3xl bg-violet-400/10 dark:bg-violet-500/8" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[60rem] rounded-full blur-[120px] bg-emerald-400/[0.04] dark:bg-emerald-500/[0.04]" />

      <div className="relative max-w-[1200px] mx-auto px-6 py-12 sm:py-16">
        {/* Top bar — minimal */}
        <header className="flex items-center justify-between mb-12 sm:mb-20 fade-in-up">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              TradeScanner
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm"
            >
              Get Started
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center mx-auto max-w-3xl fade-in-up" style={{ animationDelay: "60ms" }}>
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-300">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            Live market intelligence
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 leading-[1.05]">
            See what the market is{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 via-cyan-500 to-violet-500">
              actually doing.
            </span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            Real-time observation across momentum, participation, volatility and price zones for every NSE stock.
            Built for people who want to understand live market behavior.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-lg shadow-zinc-900/10 dark:shadow-zinc-100/10 hover:-translate-y-0.5"
            >
              Create a free account
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/login"
              className="px-5 py-3 rounded-xl text-sm font-semibold text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </section>

        {/* Core metrics showcase — 4 cards */}
        <section className="mt-20 sm:mt-28">
          <div className="text-center mb-10 fade-in-up" style={{ animationDelay: "120ms" }}>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
              Four market factors. One live view.
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto">
              Every stock card surfaces these four observations in real time, so you can read context
              without flipping between charts.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricShowcase
              Icon={Activity}
              title="Momentum"
              subtitle="Building, stable, weakening"
              description="5-minute weighted return shows how price energy is evolving."
              accent="purple"
              barFill={4}
              dir="up"
              delay={180}
            />
            <MetricShowcase
              Icon={Gauge}
              title="Pressure"
              subtitle="Buying or selling activity"
              description="Aggressor volume balance — who's actually moving the tape."
              accent="cyan"
              barFill={3}
              dir="up"
              delay={240}
            />
            <MetricShowcase
              Icon={Zap}
              title="Volatility"
              subtitle="Low, moderate, elevated"
              description="Intraday range vs. recent baseline. Sets the noise floor."
              accent="amber"
              barFill={3}
              dir="flat"
              delay={300}
            />
            <MetricShowcase
              Icon={Target}
              title="Zones"
              subtitle="Near support or resistance"
              description="Distance from the closest reactive level intraday."
              accent="emerald"
              barFill={5}
              dir="up"
              delay={360}
            />
          </div>
        </section>

        {/* What you get — 3 short bullets */}
        <section className="mt-20 sm:mt-28">
          <div className="text-center mb-10 fade-in-up" style={{ animationDelay: "420ms" }}>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
              What you'll see inside.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            <FeatureBullet
              Icon={Sparkles}
              title="Strong market activity"
              text="Stocks where momentum, participation and volatility move together in real time."
              accent="amber"
              delay={480}
            />
            <FeatureBullet
              Icon={LayoutGrid}
              title="Near-level activity"
              text="Surfaced the moment price approaches a recent support or resistance area."
              accent="emerald"
              delay={540}
            />
            <FeatureBullet
              Icon={Eye}
              title="Pure observation"
              text="No buy or sell language. Understand live market behavior, decide for yourself."
              accent="cyan"
              delay={600}
            />
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-20 sm:mt-28 mb-12 fade-in-up" style={{ animationDelay: "660ms" }}>
          <div className="relative overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-gradient-to-br from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-900/40 dark:to-zinc-950 px-8 py-12 text-center">
            <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 size-72 rounded-full blur-3xl bg-emerald-400/10" />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                Explore real-time market behavior
              </h2>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">
                Free to use during the closed beta. No credit card.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-lg hover:-translate-y-0.5"
                >
                  Create your account
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Disclaimer — visible, two-paragraph SEBI-safe copy. Critical for any
            external review (regulators / payment gateways / Meta / ad networks). */}
        <section className="mt-8 mb-4">
          <div className="mx-auto max-w-3xl rounded-2xl border border-amber-500/25 dark:border-amber-500/20 bg-amber-500/[0.04] dark:bg-amber-500/[0.04] px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700 dark:text-amber-300/90 text-center">
              Disclaimer
            </div>
            <p className="mt-3 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed text-center">
              TradeScanner provides educational market observations based on momentum, participation, volatility and price behavior.
            </p>
            <p className="mt-2 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed text-center">
              This platform does not provide investment advice, buy/sell recommendations, or guaranteed outcomes.
            </p>
          </div>
        </section>
      </div>

      {/* Inline keyframes — kept here so the landing is self-contained */}
      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        :global(.fade-in-up) {
          animation: fadeInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </main>
  );
}

// Showcase card for a single core metric. Subtle hover lift + animated
// strength-bar fill on first paint to communicate "live" without being noisy.
function MetricShowcase({
  Icon,
  title,
  subtitle,
  description,
  accent,
  barFill,
  dir,
  delay,
}: {
  Icon: typeof Activity;
  title: string;
  subtitle: string;
  description: string;
  accent: "purple" | "cyan" | "amber" | "emerald";
  barFill: number;
  dir: "up" | "down" | "flat";
  delay: number;
}) {
  const accentColor = {
    purple: { text: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/15", ring: "ring-purple-400/30", glow: "bg-purple-400/10" },
    cyan: { text: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/15", ring: "ring-cyan-400/30", glow: "bg-cyan-400/10" },
    amber: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/15", ring: "ring-amber-400/30", glow: "bg-amber-400/10" },
    emerald: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/15", ring: "ring-emerald-400/30", glow: "bg-emerald-400/10" },
  }[accent];

  const fillClass = dir === "up"
    ? "bg-emerald-500 dark:bg-emerald-400"
    : dir === "down"
    ? "bg-rose-500 dark:bg-rose-400"
    : "bg-zinc-400 dark:bg-zinc-500";

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`pointer-events-none absolute -top-12 -right-12 size-32 rounded-full blur-3xl ${accentColor.glow} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      <div className="relative">
        <div className={`flex size-11 items-center justify-center rounded-xl ${accentColor.bg} ring-1 ${accentColor.ring}`}>
          <Icon className={`size-5 ${accentColor.text}`} strokeWidth={2.4} />
        </div>
        <h3 className="mt-4 text-base font-bold text-zinc-900 dark:text-zinc-50">{title}</h3>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          {subtitle}
        </p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {description}
        </p>

        {/* Animated strength bar — fades in cells on mount */}
        <div className="mt-4">
          <AnimatedStrengthBar fill={barFill} fillClass={fillClass} />
        </div>
      </div>
    </div>
  );
}

function AnimatedStrengthBar({ fill, fillClass }: { fill: number; fillClass: string }) {
  // Cells animate in with a stagger so the bar visually "fills" on first paint.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setShown((n) => (n >= fill ? n : n + 1));
    }, 110);
    return () => window.clearInterval(id);
  }, [fill]);
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-2 w-3.5 rounded-sm transition-colors duration-500 ${i <= shown ? fillClass : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </div>
  );
}

function FeatureBullet({
  Icon,
  title,
  text,
  accent,
  delay,
}: {
  Icon: typeof Activity;
  title: string;
  text: string;
  accent: "amber" | "emerald" | "cyan";
  delay: number;
}) {
  const accentColor = {
    amber: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/15", ring: "ring-amber-400/30" },
    emerald: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/15", ring: "ring-emerald-400/30" },
    cyan: { text: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/15", ring: "ring-cyan-400/30" },
  }[accent];

  return (
    <div
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`flex size-9 items-center justify-center rounded-xl ${accentColor.bg} ring-1 ${accentColor.ring}`}>
        <Icon className={`size-4 ${accentColor.text}`} strokeWidth={2.4} />
      </div>
      <h3 className="mt-4 text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {text}
      </p>
    </div>
  );
}
