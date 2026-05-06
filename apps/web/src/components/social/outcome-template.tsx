import { Check, Clock, X } from "lucide-react";
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

      {/* Content — vertically centered between header and disclaimer */}
      <div className="flex-1 flex flex-col justify-center px-12 py-10">
        {/* Hero — symbol + prominent "after X min" stamp */}
        <div>
          <div className="flex items-end justify-between gap-8">
            <h1 className="text-[96px] font-extrabold tracking-tight text-white leading-none">
              {signal.symbol}
            </h1>
            <div className={`inline-flex items-center gap-3 px-5 py-3 rounded-2xl border ${succeeded ? "border-emerald-400/40 bg-emerald-500/[0.08]" : "border-rose-400/40 bg-rose-500/[0.08]"}`}>
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
          </p>
        </div>

        {/* Section: Observed Behavior */}
        <div className="mt-12">
          <SectionHeader>Observed Behavior</SectionHeader>
          <div className="mt-7 space-y-6">
            {observations.map((obs, i) => (
              <ObservationRow key={i} observation={obs} accentText={accentText} />
            ))}
          </div>
        </div>

        {/* Section: Insight */}
        <div className="mt-11">
          <SectionHeader>Insight</SectionHeader>
          <p className="mt-4 text-slate-200 text-[28px] font-medium leading-snug max-w-[920px]">
            {outcomeInsight(signal)}
          </p>
        </div>
      </div>

      {/* Disclaimer — centered footer */}
      <div className="px-12 pb-10 flex justify-center">
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
