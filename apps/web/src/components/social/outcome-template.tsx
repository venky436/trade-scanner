import { ArrowDown, ArrowUp, Clock, Minus } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  BrandHeader,
  NEUTRAL_THRESHOLD_PERCENT,
  observedActivity,
  outcomeInsightObservational,
  type ObservedActivity,
} from "./template-shared";

export function OutcomeTemplate({ signal }: { signal: SocialSignal }) {
  // Lock-in is at minute 10 with the direction-snapshot model. Compute live so
  // historical rows (locked at variable time under prior models) still read right.
  const lockMinutes = signal.evaluatedAt
    ? Math.max(1, Math.round(
        (new Date(signal.evaluatedAt).getTime() - new Date(signal.signalTime).getTime()) / 60_000,
      ))
    : 10;

  const activities = observedActivity(signal);

  // Direction colour for the hero stamp & accent — uses the actual price-change
  // direction (factual). NOT a "win/loss" indicator; just a descriptive
  // observation of which way price moved. Anything inside the ±0.2% NEUTRAL
  // dead-zone collapses to slate (limited-movement) regardless of micro
  // direction so we don't paint a 0.05% wiggle as a green "up" outcome.
  const change = Number(signal.changePercent ?? 0);
  const isNeutral = Math.abs(change) < NEUTRAL_THRESHOLD_PERCENT;
  const movedUp = !isNeutral && change > 0;
  const movedDown = !isNeutral && change < 0;
  const accentText = movedUp
    ? "text-emerald-400"
    : movedDown
    ? "text-rose-400"
    : "text-slate-400";
  const accentBorder = movedUp
    ? "border-emerald-400/40"
    : movedDown
    ? "border-rose-400/40"
    : "border-slate-400/40";
  const accentBg = movedUp
    ? "bg-emerald-500/[0.08]"
    : movedDown
    ? "bg-rose-500/[0.08]"
    : "bg-slate-500/[0.08]";
  const accentGrad = movedUp
    ? "from-emerald-400/0 via-emerald-400/60 to-emerald-400/0"
    : movedDown
    ? "from-rose-400/0 via-rose-400/60 to-rose-400/0"
    : "from-slate-400/0 via-slate-400/60 to-slate-400/0";

  return (
    <TemplateFrame>
      <BrandHeader />

      {/* Content — vertically centered between header and disclaimer */}
      <div className="flex-1 flex flex-col justify-center px-12 py-10">
        {/* Hero — symbol + prominent "after X min" stamp */}
        <div>
          <div className="flex items-end justify-between gap-8">
            <h1 className="text-[96px] font-extrabold tracking-tight text-white leading-none">
              {signal.symbol}
            </h1>
            <div className={`inline-flex items-center gap-3 px-5 py-3 rounded-2xl border ${accentBorder} ${accentBg}`}>
              <Clock className={`size-7 ${accentText}`} strokeWidth={2.5} />
              <div className="flex flex-col leading-tight">
                <span className="text-slate-400 text-[12px] font-bold tracking-[0.3em] uppercase">
                  After
                </span>
                <span className={`${accentText} text-[36px] font-extrabold leading-none mt-0.5`}
                  style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
                >
                  {lockMinutes} min
                </span>
              </div>
            </div>
          </div>
          <div className={`mt-6 h-[2px] w-full bg-gradient-to-r ${accentGrad}`} />
          <p className="mt-4 text-slate-400 text-[22px] font-medium tracking-wide">
            Market Follow-up
            {isNeutral && (
              <span className="ml-3 text-slate-500 text-[20px]">· Limited movement</span>
            )}
          </p>
        </div>

        {/* Section: Observed Activity (no win/loss framing) */}
        <div className="mt-12">
          <SectionHeader>Observed Activity</SectionHeader>
          <div className="mt-7 space-y-6">
            {activities.map((a, i) => (
              <ActivityRow key={i} activity={a} />
            ))}
          </div>
        </div>

        {/* Section: Insight */}
        <div className="mt-11">
          <SectionHeader>Insight</SectionHeader>
          <p className="mt-4 text-slate-200 text-[28px] font-medium leading-snug max-w-[920px]">
            {outcomeInsightObservational()}
          </p>
        </div>
      </div>

      {/* Disclaimer — centered footer */}
      <div className="px-12 pb-10 flex justify-center">
        <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full border border-cyan-400/25 bg-cyan-500/[0.05]">
          <span className="text-cyan-400/90 text-[18px]">📊</span>
          <span className="text-cyan-200/85 text-[15px] font-medium tracking-wide">
            Market observation — not financial advice
          </span>
        </div>
      </div>
    </TemplateFrame>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-slate-500 text-[13px] font-bold tracking-[0.4em] uppercase">
        {children}
      </span>
      <div className="flex-1 h-px bg-slate-800/80" />
    </div>
  );
}

// Neutral activity row — directional arrow indicator (up / down / flat) instead
// of check/X icons. Communicates *direction of observation*, never success/fail.
function ActivityRow({ activity }: { activity: ObservedActivity }) {
  const Icon =
    activity.dir === "up" ? ArrowUp : activity.dir === "down" ? ArrowDown : Minus;
  const iconColor =
    activity.dir === "up"
      ? "text-emerald-400"
      : activity.dir === "down"
      ? "text-rose-400"
      : "text-slate-400";
  const iconBg =
    activity.dir === "up"
      ? "border-emerald-400/30 bg-emerald-500/10"
      : activity.dir === "down"
      ? "border-rose-400/30 bg-rose-500/10"
      : "border-slate-400/30 bg-slate-500/10";

  return (
    <div className="flex items-center gap-5">
      <div className={`flex items-center justify-center size-10 rounded-full border ${iconBg}`}>
        <Icon className={`size-5 ${iconColor}`} strokeWidth={3} />
      </div>
      <span className="text-white text-[26px] font-medium">{activity.text}</span>
    </div>
  );
}
