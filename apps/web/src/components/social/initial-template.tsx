import { MapPin, TrendingUp, TrendingDown, Activity, Waves, Diamond } from "lucide-react";
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
  getDirection,
  directionColor,
} from "./template-shared";

interface FactorRow {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  iconColor: string;
  label: string;
  value: string;
}

export function InitialTemplate({ signal }: { signal: SocialSignal }) {
  const direction = getDirection(signal);
  const dir = directionColor(direction);
  const isBullish = direction === "BULLISH";
  const isBearish = direction === "BEARISH";
  const momentumIcon = isBearish ? TrendingDown : TrendingUp;
  const momentumIconColor = isBullish ? "text-emerald-400" : isBearish ? "text-rose-400" : "text-amber-400";
  const pressureIconColor = isBullish ? "text-emerald-400" : isBearish ? "text-rose-400" : "text-violet-400";

  const factors: FactorRow[] = [
    { icon: MapPin, iconColor: "text-cyan-400", label: "ZONE", value: zoneLabel(signal.zone) },
    { icon: momentumIcon, iconColor: momentumIconColor, label: "MOMENTUM", value: momentumLabel(signal) },
    { icon: Activity, iconColor: pressureIconColor, label: "PRESSURE", value: pressureLabel(signal) },
    { icon: Waves, iconColor: "text-amber-400", label: "VOLATILITY", value: volatilityLabel(signal.volatilityScore) },
  ];

  const alignment = alignmentLabel(signal.confidence);

  return (
    <TemplateFrame>
      <EducationalBanner />

      {/* Hero — symbol + accent bar + subtitle */}
      <div className="flex flex-col items-center justify-center pt-20 pb-10">
        <h1 className="text-[148px] font-extrabold tracking-tight text-white leading-none">
          {signal.symbol}
        </h1>
        <div className={`mt-6 h-[5px] w-32 rounded-full bg-gradient-to-r ${dir.grad}`} />
        <p className="mt-7 text-[28px] font-medium text-slate-400 tracking-wide">
          Market Behavior Snapshot
        </p>
      </div>

      {/* Factor card */}
      <div className="px-20 mt-2">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl px-12 py-10">
          {factors.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className={`flex items-center justify-between py-5 ${
                  i < factors.length - 1 ? "border-b border-slate-800/70" : ""
                }`}
              >
                <div className="flex items-center gap-5">
                  <div className="flex items-center justify-center size-12 rounded-xl bg-slate-800/60 border border-slate-700/50">
                    <Icon className={`size-6 ${f.iconColor}`} />
                  </div>
                  <span className="text-slate-500 text-[14px] font-semibold tracking-[0.3em] uppercase">
                    {f.label}
                  </span>
                </div>
                <span className="text-white text-[26px] font-semibold">{f.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alignment pill */}
      <div className="flex justify-center mt-10">
        <div
          className={`inline-flex items-center gap-5 px-10 py-5 rounded-full border bg-gradient-to-r from-cyan-500/15 via-violet-500/15 to-cyan-500/15 border-cyan-400/30 ${dir.glow}`}
        >
          <Diamond className="size-5 text-cyan-400 fill-cyan-400/30" />
          <span className="text-white text-[22px] font-bold tracking-[0.35em]">
            FACTOR ALIGNMENT &nbsp;·&nbsp; {alignment}
          </span>
          <Diamond className="size-5 text-cyan-400 fill-cyan-400/30" />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      <DisclaimerFooter />
    </TemplateFrame>
  );
}
