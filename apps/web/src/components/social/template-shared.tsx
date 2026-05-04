// Shared types + helpers for the social-template renderers (initial + outcome).
// These templates are 1080×1080 squares meant to be screenshotted by an admin
// and posted to Telegram / Instagram. NOT public-facing as live UI.

export interface SocialSignal {
  id: number;
  symbol: string;
  signalTime: string;
  priceAtSignal: string;
  outlook: string;
  confidence: string;
  confidenceBucket: string;
  zone: string;
  bias: string;
  volatilityScore: string | null;
  status: string;
  priceAfter: string | null;
  changePercent: string | null;
  maxPrice: string | null;
  minPrice: string | null;
  maxProfitPercent: string | null;
  maxDrawdownPercent: string | null;
  evaluatedAt: string | null;
}

export type Direction = "BULLISH" | "BEARISH" | "NEUTRAL";

const BULLISH_OUTLOOKS = new Set(["BREAKOUT_LIKELY", "BOUNCE_EXPECTED"]);
const BEARISH_OUTLOOKS = new Set(["REJECTION_POSSIBLE", "BREAKDOWN_RISK"]);

export function getDirection(signal: Pick<SocialSignal, "outlook" | "bias">): Direction {
  if (BULLISH_OUTLOOKS.has(signal.outlook)) return "BULLISH";
  if (BEARISH_OUTLOOKS.has(signal.outlook)) return "BEARISH";
  if (signal.bias === "BULLISH") return "BULLISH";
  if (signal.bias === "BEARISH") return "BEARISH";
  return "NEUTRAL";
}

export function zoneLabel(zone: string): string {
  if (zone === "NEAR_SUPPORT") return "Near Support";
  if (zone === "NEAR_RESISTANCE") return "Near Resistance";
  return "Mid Range";
}

export function momentumLabel(signal: Pick<SocialSignal, "outlook" | "confidence">): string {
  const conf = Number(signal.confidence);
  if (signal.outlook === "BREAKOUT_LIKELY" || signal.outlook === "REJECTION_POSSIBLE") {
    return conf >= 0.9 ? "Strong" : "Building";
  }
  if (signal.outlook === "BOUNCE_EXPECTED" || signal.outlook === "BREAKDOWN_RISK") {
    return conf >= 0.85 ? "Building" : "Forming";
  }
  return "Mixed";
}

export function pressureLabel(signal: Pick<SocialSignal, "bias" | "confidence">): string {
  const conf = Number(signal.confidence);
  if (signal.bias === "BULLISH") return conf >= 0.9 ? "Strong Buying" : "Buying Present";
  if (signal.bias === "BEARISH") return conf >= 0.9 ? "Strong Selling" : "Selling Present";
  return "Mixed";
}

export function volatilityLabel(score: string | null): string {
  const v = Number(score ?? 0);
  if (v >= 0.7) return "High";
  if (v >= 0.4) return "Medium";
  return "Low";
}

export function alignmentLabel(confidence: string): string {
  const conf = Number(confidence);
  if (conf >= 0.9) return "STRONG";
  if (conf >= 0.8) return "ALIGNED";
  return "FORMING";
}

export function directionColor(direction: Direction) {
  if (direction === "BULLISH") return { text: "text-emerald-400", glow: "shadow-[0_0_60px_rgba(16,185,129,0.25)]", grad: "from-emerald-400 to-cyan-400" };
  if (direction === "BEARISH") return { text: "text-rose-400", glow: "shadow-[0_0_60px_rgba(244,63,94,0.25)]", grad: "from-rose-400 to-amber-400" };
  return { text: "text-amber-400", glow: "shadow-[0_0_60px_rgba(245,158,11,0.25)]", grad: "from-amber-400 to-violet-400" };
}

export function formatSigned(percentStr: string | null): string {
  if (percentStr == null) return "—";
  const v = Number(percentStr);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// Derive outcome verdict from status. SUCCESS → played out for the predicted
// direction (price moved in expected direction by ≥ 0.3%). FAILED → moved
// opposite. NEUTRAL → didn't move enough either way.
export interface OutcomeVerdict {
  pillBg: string;
  pillBorder: string;
  pillText: string;
  pillIconColor: string;
  bigNumberColor: string;
  bigGlow: string;
  text: string;
  iconKind: "check" | "x" | "minus";
}

export function outcomeVerdict(status: string): OutcomeVerdict {
  if (status === "SUCCESS") {
    return {
      pillBg: "bg-emerald-500/15",
      pillBorder: "border-emerald-400/40",
      pillText: "text-emerald-300",
      pillIconColor: "text-emerald-400",
      bigNumberColor: "text-emerald-400",
      bigGlow: "shadow-[0_0_80px_rgba(16,185,129,0.25)]",
      text: "PLAYED OUT AS SYSTEM OBSERVED",
      iconKind: "check",
    };
  }
  if (status === "FAILED") {
    return {
      pillBg: "bg-rose-500/15",
      pillBorder: "border-rose-400/40",
      pillText: "text-rose-300",
      pillIconColor: "text-rose-400",
      bigNumberColor: "text-rose-400",
      bigGlow: "shadow-[0_0_80px_rgba(244,63,94,0.25)]",
      text: "DID NOT PLAY OUT THIS TIME",
      iconKind: "x",
    };
  }
  return {
    pillBg: "bg-amber-500/15",
    pillBorder: "border-amber-400/40",
    pillText: "text-amber-300",
    pillIconColor: "text-amber-400",
    bigNumberColor: "text-amber-400",
    bigGlow: "shadow-[0_0_80px_rgba(245,158,11,0.25)]",
    text: "NO CLEAR MOVEMENT",
    iconKind: "minus",
  };
}

// Common 1080×1080 wrapper with the deep-navy gradient background + corner glow.
export function TemplateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex flex-col w-[1080px] h-[1080px] text-white overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 85% 10%, rgba(30, 64, 175, 0.18), transparent 55%), radial-gradient(circle at 15% 90%, rgba(139, 92, 246, 0.10), transparent 50%), #0A0E1A",
        fontFamily: "var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      {children}
    </div>
  );
}

// Top "EDUCATIONAL · MARKET STUDY" banner, used by both templates.
export function EducationalBanner() {
  return (
    <div className="flex items-center justify-center gap-3 px-10 py-5 bg-amber-500/[0.06] border-b border-amber-500/20">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/90">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span className="text-amber-400/90 text-[15px] font-semibold tracking-[0.4em] uppercase">
        Educational · Market Study
      </span>
    </div>
  );
}

// Bottom disclaimer, two lines, slate-500.
export function DisclaimerFooter({ outcome = false }: { outcome?: boolean }) {
  const line1 = outcome
    ? "Factual market data · Past data does not predict future"
    : "For educational study only · Not investment advice";
  const line2 = outcome
    ? "Not investment advice · Not SEBI registered"
    : "Past patterns do not predict future · Not SEBI registered";
  return (
    <div className="px-10 py-6 border-t border-slate-800/80 text-center">
      <p className="text-slate-500 text-[15px] tracking-wide leading-relaxed">{line1}</p>
      <p className="text-slate-500 text-[15px] tracking-wide leading-relaxed">{line2}</p>
    </div>
  );
}
