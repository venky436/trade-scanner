import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown, Check, X, Clock } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  EducationalBanner,
  DisclaimerFooter,
  formatSigned,
  formatTimeIST,
  formatDateIST,
  outcomeVerdict,
} from "./template-shared";

export function OutcomeTemplate({ signal }: { signal: SocialSignal }) {
  const verdict = outcomeVerdict(signal.status);
  const change = Number(signal.changePercent ?? 0);
  const DirectionIcon = change > 0.05 ? ArrowUp : change < -0.05 ? ArrowDown : Minus;
  const VerdictIcon = verdict.iconKind === "check" ? Check : verdict.iconKind === "x" ? X : Minus;

  const triggerTime = formatTimeIST(signal.signalTime);
  const evalTime = formatTimeIST(signal.evaluatedAt);

  return (
    <TemplateFrame>
      <EducationalBanner timestamp={evalTime} dateText={formatDateIST(signal.signalTime)} />

      {/* Hero — symbol + timeline caption */}
      <div className="flex flex-col items-center pt-12 pb-6">
        <h1 className="text-[88px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
        <div className="mt-5 flex items-center gap-3 text-slate-400 text-[18px] font-medium">
          <Clock className="size-4 text-slate-500" />
          <span className="font-mono text-slate-300">{triggerTime}</span>
          <ArrowRightIcon />
          <span className="font-mono text-slate-300">{evalTime}</span>
          <span className="text-slate-500 text-[15px] tracking-wide ml-2">· 10 min later</span>
        </div>
      </div>

      {/* Big movement card */}
      <div className="px-16">
        <div
          className={`bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl py-12 px-10 flex flex-col items-center ${verdict.bigGlow}`}
        >
          <div className="flex items-center gap-5">
            <DirectionIcon className={`size-14 ${verdict.bigNumberColor}`} strokeWidth={3} />
            <span
              className={`text-[128px] font-extrabold leading-none ${verdict.bigNumberColor}`}
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.changePercent)}
            </span>
          </div>
          <p className="mt-5 text-slate-400 text-[16px] font-semibold tracking-[0.4em]">
            PRICE MOVEMENT
          </p>
        </div>
      </div>

      {/* Best / Worst grid */}
      <div className="px-16 mt-6">
        <div className="grid grid-cols-2 gap-5">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-7 py-6">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/15 border border-emerald-400/25">
                <TrendingUp className="size-4 text-emerald-300" />
              </div>
              <span className="text-slate-400 text-[12px] font-semibold tracking-[0.3em] uppercase">
                Best
              </span>
            </div>
            <div
              className="mt-4 text-[52px] font-bold text-emerald-400 leading-none"
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.maxProfitPercent)}
            </div>
            <p className="mt-2 text-slate-500 text-[14px]">intraday peak</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-7 py-6">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center size-8 rounded-lg bg-rose-500/15 border border-rose-400/25">
                <TrendingDown className="size-4 text-rose-300" />
              </div>
              <span className="text-slate-400 text-[12px] font-semibold tracking-[0.3em] uppercase">
                Worst
              </span>
            </div>
            <div
              className="mt-4 text-[52px] font-bold text-rose-400 leading-none"
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.maxDrawdownPercent)}
            </div>
            <p className="mt-2 text-slate-500 text-[14px]">intraday dip</p>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="flex justify-center mt-7">
        <div
          className={`inline-flex items-center gap-3.5 px-8 py-4 rounded-full border ${verdict.pillBg} ${verdict.pillBorder}`}
        >
          <VerdictIcon className={`size-5 ${verdict.pillIconColor}`} strokeWidth={3} />
          <span className={`text-[18px] font-bold tracking-[0.25em] ${verdict.pillText}`}>
            {verdict.text}
          </span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      <DisclaimerFooter />
    </TemplateFrame>
  );
}

// Inline arrow icon used between the two timestamps in the hero caption.
function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
