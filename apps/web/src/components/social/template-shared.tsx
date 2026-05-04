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
  changePoints: string | null;
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

// Number of filled dots out of 3 — visual confidence-tier indicator on the
// alignment pill. Avoids showing the literal % which we don't surface.
export function alignmentDots(confidence: string): number {
  const conf = Number(confidence);
  if (conf >= 0.9) return 3;
  if (conf >= 0.8) return 2;
  return 1;
}

export function directionAccent(direction: Direction) {
  if (direction === "BULLISH") {
    return {
      text: "text-emerald-400",
      glow: "shadow-[0_0_60px_rgba(16,185,129,0.25)]",
      grad: "from-emerald-400 to-cyan-400",
      pillBg: "bg-emerald-500/10",
      pillBorder: "border-emerald-400/40",
      arrowKind: "up" as const,
      arrowLabel: "BULLISH SETUP",
    };
  }
  if (direction === "BEARISH") {
    return {
      text: "text-rose-400",
      glow: "shadow-[0_0_60px_rgba(244,63,94,0.25)]",
      grad: "from-rose-400 to-amber-400",
      pillBg: "bg-rose-500/10",
      pillBorder: "border-rose-400/40",
      arrowKind: "down" as const,
      arrowLabel: "BEARISH SETUP",
    };
  }
  return {
    text: "text-amber-400",
    glow: "shadow-[0_0_60px_rgba(245,158,11,0.25)]",
    grad: "from-amber-400 to-violet-400",
    pillBg: "bg-amber-500/10",
    pillBorder: "border-amber-400/40",
    arrowKind: "neutral" as const,
    arrowLabel: "MIXED SETUP",
  };
}

export function formatSigned(value: string | null, suffix = "%"): string {
  if (value == null) return "—";
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}${suffix}`;
}

// IST time formatters used in template headers.
export function formatTimeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateIST(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

// Common 1080×1080 wrapper with the deep-navy gradient background + corner glows.
// Subtle dotted texture overlay adds visual depth without competing for attention.
export function TemplateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex flex-col w-[1080px] h-[1080px] text-white overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 85% 5%, rgba(6, 182, 212, 0.18), transparent 50%), radial-gradient(circle at 10% 95%, rgba(139, 92, 246, 0.14), transparent 55%), #0A0E1A",
        fontFamily: "var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      {/* Faint dotted texture for depth */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative flex flex-col w-full h-full">{children}</div>
    </div>
  );
}

// Top "EDUCATIONAL · MARKET STUDY" banner with optional timestamp on the right.
// Renders trigger time on Initial, signal time on Outcome (with eval time below in body).
export function EducationalBanner({ timestamp, dateText }: { timestamp?: string; dateText?: string }) {
  return (
    <div className="flex items-center justify-between px-10 py-5 bg-amber-500/[0.06] border-b border-amber-500/20">
      <div className="flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/90">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span className="text-amber-400/90 text-[14px] font-semibold tracking-[0.4em] uppercase">
          Educational · Market Study
        </span>
      </div>
      {timestamp && (
        <div className="flex flex-col items-end leading-tight">
          <span className="text-slate-300 text-[15px] font-semibold tracking-wide font-mono">
            {timestamp}
          </span>
          {dateText && (
            <span className="text-slate-500 text-[11px] tracking-widest uppercase mt-0.5">
              {dateText}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Bottom disclaimer — single line, identical for both Initial and Outcome.
export function DisclaimerFooter() {
  return (
    <div className="px-10 py-6 border-t border-slate-800/80 text-center">
      <p className="text-slate-500 text-[15px] tracking-wide leading-relaxed">
        For educational study only
      </p>
    </div>
  );
}
