import { ArrowUp, ArrowDown } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  BrandHeader,
  momentumLabel,
  pressurePhrase,
  volatilityPhrase,
  contextPhrase,
  systemInsight,
  getDirection,
  formatPrice,
} from "./template-shared";

export function InitialTemplate({ signal }: { signal: SocialSignal }) {
  const direction = getDirection(signal);
  const isBearish = direction === "BEARISH";
  const accentText = isBearish ? "text-rose-400" : "text-emerald-400";
  const accentGrad = isBearish ? "from-rose-400/0 via-rose-400/60 to-rose-400/0" : "from-emerald-400/0 via-emerald-400/60 to-emerald-400/0";
  const DirArrow = isBearish ? ArrowDown : ArrowUp;

  return (
    <TemplateFrame>
      <BrandHeader />

      {/* Content — vertically centered in the canvas space between header and disclaimer */}
      <div className="flex-1 flex flex-col justify-center px-12 py-10">
        {/* Hero — symbol + price */}
        <div>
          <div className="flex items-baseline justify-between gap-8">
            <h1 className="text-[96px] font-extrabold tracking-tight text-white leading-none">
              {signal.symbol}
            </h1>
            <span
              className="text-[60px] font-bold text-slate-200 leading-none tracking-tight"
              style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}
            >
              {formatPrice(signal.priceAtSignal)}
            </span>
          </div>
          <div className={`mt-6 h-[2px] w-full bg-gradient-to-r ${accentGrad}`} />
        </div>

        {/* Section: Market Snapshot */}
        <div className="mt-12">
          <SectionHeader>Market Snapshot</SectionHeader>
          <div className="mt-7 space-y-6">
            <Row label="Momentum">
              <span className="text-white text-[28px] font-semibold">{momentumLabel(signal)}</span>
              <DirArrow className={`size-7 ${accentText}`} strokeWidth={3} />
            </Row>
            <Row label="Pressure">
              <span className="text-white text-[28px] font-semibold">{pressurePhrase(signal)}</span>
            </Row>
            <Row label="Volatility">
              <span className="text-white text-[28px] font-semibold">{volatilityPhrase(signal.volatilityScore)}</span>
            </Row>
          </div>
        </div>

        {/* Section: Context */}
        <div className="mt-11">
          <SectionHeader>Context</SectionHeader>
          <p className="mt-4 text-slate-200 text-[30px] font-medium leading-snug">
            {contextPhrase(signal.zone)}
          </p>
        </div>

        {/* Section: System Insight */}
        <div className="mt-10">
          <SectionHeader>System Insight</SectionHeader>
          <p className="mt-4 text-slate-200 text-[30px] font-medium leading-snug max-w-[880px]">
            {systemInsight(signal)}
          </p>
        </div>
      </div>

      {/* Educational disclaimer — centered footer */}
      <div className="px-12 pb-10 flex justify-center">
        <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full border border-amber-400/30 bg-amber-500/[0.06]">
          <span className="text-amber-400/90 text-[18px]">⚠️</span>
          <span className="text-amber-300/90 text-[15px] font-medium tracking-wide">
            For educational purposes only
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_24px_1fr] items-center gap-4">
      <span className="text-slate-400 text-[20px] font-medium tracking-wide">{label}</span>
      <span className="text-slate-600 text-[24px] font-light">→</span>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}
