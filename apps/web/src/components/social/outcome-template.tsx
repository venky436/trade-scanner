import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown, Check, X } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  EducationalBanner,
  DisclaimerFooter,
  formatSigned,
  outcomeVerdict,
} from "./template-shared";

export function OutcomeTemplate({ signal }: { signal: SocialSignal }) {
  const verdict = outcomeVerdict(signal.status);
  const change = Number(signal.changePercent ?? 0);
  const directionIcon = change > 0.05 ? ArrowUp : change < -0.05 ? ArrowDown : Minus;
  const DirectionIcon = directionIcon;

  const VerdictIcon = verdict.iconKind === "check" ? Check : verdict.iconKind === "x" ? X : Minus;

  return (
    <TemplateFrame>
      <EducationalBanner />

      {/* Hero — symbol + subtitle */}
      <div className="flex flex-col items-center justify-center pt-20 pb-12">
        <h1 className="text-[100px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
        <p className="mt-5 text-[28px] font-medium text-slate-400 tracking-wide">
          10 Minutes Later
        </p>
      </div>

      {/* Big movement card */}
      <div className="px-20">
        <div
          className={`bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl py-16 px-12 flex flex-col items-center ${verdict.bigGlow}`}
        >
          <div className="flex items-center gap-6">
            <DirectionIcon className={`size-16 ${verdict.bigNumberColor}`} strokeWidth={3} />
            <span
              className={`text-[140px] font-extrabold leading-none ${verdict.bigNumberColor}`}
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.changePercent)}
            </span>
          </div>
          <p className="mt-6 text-slate-400 text-[18px] font-semibold tracking-[0.4em]">
            PRICE MOVEMENT
          </p>
        </div>
      </div>

      {/* Best / Worst grid */}
      <div className="px-20 mt-8">
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-8 py-7">
            <div className="flex items-center gap-3">
              <TrendingUp className="size-5 text-emerald-400" />
              <span className="text-slate-500 text-[13px] font-semibold tracking-[0.3em] uppercase">
                Best
              </span>
            </div>
            <div
              className="mt-4 text-[56px] font-bold text-emerald-400 leading-none"
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.maxProfitPercent)}
            </div>
            <p className="mt-3 text-slate-500 text-[15px]">intraday peak</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-8 py-7">
            <div className="flex items-center gap-3">
              <TrendingDown className="size-5 text-rose-400" />
              <span className="text-slate-500 text-[13px] font-semibold tracking-[0.3em] uppercase">
                Worst
              </span>
            </div>
            <div
              className="mt-4 text-[56px] font-bold text-rose-400 leading-none"
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.maxDrawdownPercent)}
            </div>
            <p className="mt-3 text-slate-500 text-[15px]">intraday dip</p>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="flex justify-center mt-10">
        <div
          className={`inline-flex items-center gap-4 px-9 py-5 rounded-full border ${verdict.pillBg} ${verdict.pillBorder}`}
        >
          <VerdictIcon className={`size-6 ${verdict.pillIconColor}`} strokeWidth={3} />
          <span className={`text-[20px] font-bold tracking-[0.25em] ${verdict.pillText}`}>
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
