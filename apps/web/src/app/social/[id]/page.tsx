"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle, Image as ImageIcon, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { SocialSignal } from "@/components/social/template-shared";
import { InitialTemplate } from "@/components/social/initial-template";
import { OutcomeTemplate } from "@/components/social/outcome-template";

type View = "initial" | "outcome";

function isView(v: string | null): v is View {
  return v === "initial" || v === "outcome";
}

function formatEvalETA(signalTimeIso: string): string {
  const eta = new Date(signalTimeIso).getTime() + 10 * 60_000;
  const now = Date.now();
  if (now >= eta) return "any moment now";
  const minsLeft = Math.ceil((eta - now) / 60_000);
  return `in ~${minsLeft} ${minsLeft === 1 ? "minute" : "minutes"}`;
}

export default function SocialTemplatePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [signal, setSignal] = useState<SocialSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const viewParam = searchParams.get("view");
  const view: View = isView(viewParam) ? viewParam : "initial";

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        setError(null);
        const res = await apiFetch(`/api/admin/social/${params.id}`);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error ?? `Status ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          setSignal(data.signal ?? null);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message ?? "Failed to load");
          setLoading(false);
        }
      }
    }
    fetchData();
    // For pending outcomes, poll every 30s — matches the backend snapshot
    // cadence so the page transitions within ~one cycle of the lock-in.
    const interval =
      view === "outcome" && signal?.status === "PENDING"
        ? setInterval(fetchData, 30_000)
        : null;
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [params.id, view, signal?.status]);

  function setView(next: View) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("view", next);
    router.replace(`?${sp.toString()}`);
  }

  if (loading) {
    return (
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="h-12 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-6 mx-auto h-[1080px] w-[1080px] max-w-full animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800/60" />
      </main>
    );
  }

  if (error || !signal) {
    return (
      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-4">
        <Link
          href="/social"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Social
        </Link>
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-5 py-4 text-rose-600 dark:text-rose-400">
          <AlertCircle className="size-5" />
          <span className="text-sm">{error ?? "Signal not found"}</span>
        </div>
      </main>
    );
  }

  const outcomePending = signal.status === "PENDING";

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Header (NOT included in screenshot) */}
      <div className="flex items-center justify-between">
        <Link
          href="/social"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Social
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 bg-white dark:bg-zinc-900/40">
          <button
            onClick={() => setView("initial")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              view === "initial"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            Initial
          </button>
          <button
            onClick={() => setView("outcome")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              view === "outcome"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            Outcome
          </button>
        </div>
      </div>

      {/* Title (NOT included in screenshot) */}
      <div>
        <div className="flex items-center gap-3">
          <ImageIcon className="size-6 text-cyan-500" />
          <h1 className="text-2xl font-bold tracking-tight">
            {signal.symbol}
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {view === "initial" ? "Initial Template" : "Outcome Template"}
            </span>
          </h1>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          1080×1080 · Take a screenshot of the card below to post.
        </p>
      </div>

      {/* Template — pending outcome shows waiting card instead */}
      <div className="flex justify-center">
        {view === "outcome" && outcomePending ? (
          <div className="w-[1080px] h-[600px] max-w-full rounded-3xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-zinc-900/30">
            <RefreshCw className="size-10 text-zinc-400 animate-spin" />
            <h2 className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">
              Outcome Not Yet Evaluated
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              Returns {formatEvalETA(signal.signalTime)}
            </p>
            <p className="mt-2 text-xs text-zinc-400">Page auto-refreshes every 30 seconds</p>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
            {view === "initial" ? (
              <InitialTemplate signal={signal} />
            ) : (
              <OutcomeTemplate signal={signal} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
