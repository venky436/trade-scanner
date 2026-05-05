import { ArrowUp, ArrowDown, Minus, Check, X } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  EducationalBanner,
  DisclaimerFooter,
  formatSigned,
  formatTimeIST,
  formatDateIST,
  formatPrice,
  outcomeVerdict,
  socialDisplayStatus,
} from "./template-shared";

export function OutcomeTemplate({ signal }: { signal: SocialSignal }) {
  // Social rule: every evaluated signal renders as WIN or LOSS — direction wins,
  // even for tiny moves (0.05% counts). NEUTRAL never shows on the template.
  const verdict = outcomeVerdict(socialDisplayStatus(signal));
  const points = Number(signal.changePoints ?? 0);
  // No Minus case — every signal is win or loss on social, even for tiny moves.
  const DirectionIcon = points >= 0 ? ArrowUp : ArrowDown;
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

      {/* Symbol */}
      <div className="flex flex-col items-center pt-10 pb-4">
        <h1 className="text-[88px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
      </div>

      {/* Entry → Exit price card. Left/right symmetry mirrors the trade arc.
          Center column carries the arrow + duration; clean read top-to-bottom. */}
      <div className="px-16 mt-2">
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-700/40 rounded-2xl py-8 px-10">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
            <PriceColumn label="ENTRY" price={signal.priceAtSignal} time={triggerTime} />
            <div className="flex flex-col items-center gap-2">
              <ChevronArrowRight />
              <span className="text-slate-500 text-[11px] tracking-[0.3em] uppercase font-semibold">
                {lockMinutes} min
              </span>
            </div>
            <PriceColumn label="EXIT" price={signal.priceAfter} time={evalTime} alignRight />
          </div>
        </div>
      </div>

      {/* Big movement card — points moved + % subtitle */}
      <div className="px-16 mt-5">
        <div
          className={`bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl py-9 px-10 flex flex-col items-center ${verdict.bigGlow}`}
        >
          <div className="flex items-center gap-5">
            <DirectionIcon className={`size-12 ${verdict.bigNumberColor}`} strokeWidth={3} />
            <span
              className={`text-[112px] font-extrabold leading-none ${verdict.bigNumberColor}`}
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatSigned(signal.changePoints, "")}
            </span>
          </div>
          <p className="mt-4 text-slate-400 text-[15px] font-semibold tracking-[0.4em]">
            POINTS MOVED
          </p>
          <p className="mt-1.5 text-slate-500 text-[14px] tracking-wide">
            {formatSigned(signal.changePercent)}
          </p>
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

      <div className="flex-1" />

      <DisclaimerFooter />
    </TemplateFrame>
  );
}

// Single price column inside the entry→exit card. alignRight flips horizontal
// alignment so the entry sits left-aligned (towards center arrow) and exit
// right-aligned (also towards center arrow) — the two prices visually point at
// each other across the arrow.
function PriceColumn({
  label,
  price,
  time,
  alignRight = false,
}: {
  label: string;
  price: string | null;
  time: string;
  alignRight?: boolean;
}) {
  const itemAlign = alignRight ? "items-end" : "items-start";
  return (
    <div className={`flex flex-col ${itemAlign}`}>
      <span className="text-slate-500 text-[12px] font-semibold tracking-[0.35em] uppercase">
        {label}
      </span>
      <span
        className="mt-2 text-white text-[36px] font-extrabold leading-none"
        style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
      >
        {formatPrice(price)}
      </span>
      <span className="mt-2 text-slate-400 text-[13px] font-mono tracking-wide">
        {time}
      </span>
    </div>
  );
}

function ChevronArrowRight() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-500"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
