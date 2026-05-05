import { ArrowUp, ArrowDown, Minus, Check, X, Clock } from "lucide-react";
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
  const points = Number(signal.changePoints ?? 0);
  const DirectionIcon = points > 0.01 ? ArrowUp : points < -0.01 ? ArrowDown : Minus;
  const VerdictIcon = verdict.iconKind === "check" ? Check : verdict.iconKind === "x" ? X : Minus;

  const triggerTime = formatTimeIST(signal.signalTime);
  const evalTime = formatTimeIST(signal.evaluatedAt);
  // First-touch eval locks the verdict the moment price crosses TP or SL —
  // most signals lock in 1-9 min, not always at 10. Show the actual elapsed
  // duration so the timeline stays honest.
  const lockMinutes = signal.evaluatedAt
    ? Math.max(1, Math.round((new Date(signal.evaluatedAt).getTime() - new Date(signal.signalTime).getTime()) / 60_000))
    : 10;

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
          <span className="text-slate-500 text-[15px] tracking-wide ml-2">· {lockMinutes} min later</span>
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
              {formatSigned(signal.changePoints, "")}
            </span>
          </div>
          <p className="mt-5 text-slate-400 text-[16px] font-semibold tracking-[0.4em]">
            POINTS MOVED
          </p>
          <p className="mt-2 text-slate-500 text-[14px] tracking-wide">
            {formatSigned(signal.changePercent)}
          </p>
        </div>
      </div>

      {/* Status pill */}
      <div className="flex justify-center mt-10">
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
