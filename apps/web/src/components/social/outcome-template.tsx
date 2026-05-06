import { Check, X } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  BrandHeader,
  observedBehavior,
  outcomeInsight,
  socialDisplayStatus,
} from "./template-shared";

export function OutcomeTemplate({ signal }: { signal: SocialSignal }) {
  // socialDisplayStatus collapses any historical NEUTRAL into SUCCESS/FAILED;
  // new rows already arrive as SUCCESS/FAILED from the server.
  const succeeded = socialDisplayStatus(signal) === "SUCCESS";
  const accentText = succeeded ? "text-emerald-400" : "text-rose-400";
  const accentGrad = succeeded
    ? "from-emerald-400/0 via-emerald-400/60 to-emerald-400/0"
    : "from-rose-400/0 via-rose-400/60 to-rose-400/0";

  // Lock-in is at minute 10 with the direction-snapshot model. Compute live so
  // historical rows (locked at variable time under prior models) still read right.
  const lockMinutes = signal.evaluatedAt
    ? Math.max(1, Math.round(
        (new Date(signal.evaluatedAt).getTime() - new Date(signal.signalTime).getTime()) / 60_000,
      ))
    : 10;

  const observations = observedBehavior(signal);

  return (
    <TemplateFrame>
      <BrandHeader />

      {/* Hero — symbol */}
      <div className="px-12 pt-12">
        <h1 className="text-[88px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
        <div className={`mt-5 h-[2px] w-full bg-gradient-to-r ${accentGrad}`} />
      </div>

      {/* Follow-up label */}
      <div className="px-12 mt-9">
        <p className="text-slate-400 text-[22px] font-medium tracking-wide">
          Market Follow-up
          <span className="ml-3 text-slate-500 text-[20px]">
            (after {lockMinutes} min)
          </span>
        </p>
      </div>

      {/* Section: Observed Behavior */}
      <div className="px-12 mt-10">
        <SectionHeader>Observed Behavior</SectionHeader>

        <div className="mt-7 space-y-5">
          {observations.map((obs, i) => (
            <ObservationRow key={i} observation={obs} accentText={accentText} />
          ))}
        </div>
      </div>

      {/* Section: Insight */}
      <div className="px-12 mt-11">
        <SectionHeader>Insight</SectionHeader>
        <p className="mt-4 text-slate-200 text-[26px] font-medium leading-snug max-w-[880px]">
          {outcomeInsight(signal)}
        </p>
      </div>

      <div className="flex-1" />

      {/* Disclaimer — centered footer */}
      <div className="px-12 pb-12 flex justify-center">
        <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full border border-cyan-400/25 bg-cyan-500/[0.05]">
          <span className="text-cyan-400/90 text-[18px]">📊</span>
          <span className="text-cyan-200/85 text-[15px] font-medium tracking-wide">
            This illustrates market behavior
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

function ObservationRow({
  observation,
  accentText,
}: {
  observation: { ok: boolean; text: string };
  accentText: string;
}) {
  const Icon = observation.ok ? Check : X;
  return (
    <div className="flex items-center gap-5">
      <div className={`flex items-center justify-center size-10 rounded-full border ${observation.ok ? "border-emerald-400/30 bg-emerald-500/10" : "border-rose-400/30 bg-rose-500/10"}`}>
        <Icon className={`size-5 ${accentText}`} strokeWidth={3} />
      </div>
      <span className="text-white text-[26px] font-medium">{observation.text}</span>
    </div>
  );
}
