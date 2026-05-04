import { MapPin, TrendingUp, TrendingDown, Activity, Waves, Diamond, ArrowUp, ArrowDown, Minus } from "lucide-react";
import {
  type SocialSignal,
  TemplateFrame,
  EducationalBanner,
  DisclaimerFooter,
  zoneLabel,
  momentumLabel,
  pressureLabel,
  volatilityLabel,
  alignmentLabel,
  alignmentDots,
  getDirection,
  directionAccent,
  formatTimeIST,
  formatDateIST,
} from "./template-shared";

interface FactorRow {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
}

export function InitialTemplate({ signal }: { signal: SocialSignal }) {
  const direction = getDirection(signal);
  const accent = directionAccent(direction);
  const isBullish = direction === "BULLISH";
  const isBearish = direction === "BEARISH";

  const DirArrow = accent.arrowKind === "up" ? ArrowUp : accent.arrowKind === "down" ? ArrowDown : Minus;
  const momentumIcon = isBearish ? TrendingDown : TrendingUp;

  const factors: FactorRow[] = [
    {
      icon: MapPin,
      iconColor: "text-cyan-300",
      iconBg: "bg-cyan-500/15 border-cyan-400/25",
      label: "ZONE",
      value: zoneLabel(signal.zone),
    },
    {
      icon: momentumIcon,
      iconColor: isBullish ? "text-emerald-300" : isBearish ? "text-rose-300" : "text-amber-300",
      iconBg: isBullish ? "bg-emerald-500/15 border-emerald-400/25" : isBearish ? "bg-rose-500/15 border-rose-400/25" : "bg-amber-500/15 border-amber-400/25",
      label: "MOMENTUM",
      value: momentumLabel(signal),
    },
    {
      icon: Activity,
      iconColor: isBullish ? "text-emerald-300" : isBearish ? "text-rose-300" : "text-violet-300",
      iconBg: isBullish ? "bg-emerald-500/15 border-emerald-400/25" : isBearish ? "bg-rose-500/15 border-rose-400/25" : "bg-violet-500/15 border-violet-400/25",
      label: "PRESSURE",
      value: pressureLabel(signal),
    },
    {
      icon: Waves,
      iconColor: "text-amber-300",
      iconBg: "bg-amber-500/15 border-amber-400/25",
      label: "VOLATILITY",
      value: volatilityLabel(signal.volatilityScore),
    },
  ];

  const alignment = alignmentLabel(signal.confidence);
  const dots = alignmentDots(signal.confidence);

  return (
    <TemplateFrame>
      <EducationalBanner timestamp={formatTimeIST(signal.signalTime)} dateText={formatDateIST(signal.signalTime)} />

      {/* Hero — direction chip + symbol */}
      <div className="flex flex-col items-center pt-12 pb-8">
        <div className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full border ${accent.pillBg} ${accent.pillBorder} mb-6`}>
          <DirArrow className={`size-5 ${accent.text}`} strokeWidth={3} />
          <span className={`text-[12px] font-bold tracking-[0.35em] ${accent.text}`}>
            {accent.arrowLabel}
          </span>
        </div>
        <h1 className="text-[112px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
        <div className={`mt-5 h-[5px] w-28 rounded-full bg-gradient-to-r ${accent.grad}`} />
        <p className="mt-5 text-[22px] font-medium text-slate-400 tracking-wide">
          Market Behavior Snapshot
        </p>
      </div>

      {/* Factor card */}
      <div className="px-16 mt-2">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl px-10 py-6 shadow-2xl shadow-black/40">
          {factors.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className={`flex items-center justify-between py-4 ${
                  i < factors.length - 1 ? "border-b border-slate-800/70" : ""
                }`}
              >
                <div className="flex items-center gap-5">
                  <div className={`flex items-center justify-center size-12 rounded-xl border ${f.iconBg}`}>
                    <Icon className={`size-6 ${f.iconColor}`} />
                  </div>
                  <span className="text-slate-400 text-[13px] font-semibold tracking-[0.3em] uppercase">
                    {f.label}
                  </span>
                </div>
                <span className="text-white text-[26px] font-semibold">{f.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alignment pill with confidence dots */}
      <div className="flex justify-center mt-8">
        <div
          className={`inline-flex items-center gap-5 px-9 py-5 rounded-full border bg-gradient-to-r from-cyan-500/15 via-violet-500/15 to-cyan-500/15 border-cyan-400/30 ${accent.glow}`}
        >
          <Diamond className="size-5 text-cyan-400 fill-cyan-400/30" />
          <span className="text-white text-[20px] font-bold tracking-[0.3em]">
            FACTOR ALIGNMENT · {alignment}
          </span>
          <div className="flex items-center gap-1.5 ml-1">
            {[1, 2, 3].map((d) => (
              <div
                key={d}
                className={`size-2.5 rounded-full ${
                  d <= dots ? "bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]" : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      <DisclaimerFooter />
    </TemplateFrame>
  );
}
