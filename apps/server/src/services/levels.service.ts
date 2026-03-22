import type {
  Candle,
  DirectionHint,
  Proximity,
  Reaction,
  SROptions,
  SRZone,
  SupportResistanceResult,
} from "../lib/types.js";

interface Candidate {
  price: number;
  weight: number;
}

interface Cluster {
  level: number; // weighted average
  touches: number;
  weightSum: number;
  min: number;
  max: number;
}

const NULL_RESULT: SupportResistanceResult = {
  support: null,
  resistance: null,
  supportZone: null,
  resistanceZone: null,
  summary: { hasNearbySupport: false, hasNearbyResistance: false },
};

export function getSupportResistance(
  candles: Candle[],
  currentPrice: number,
  options?: SROptions,
): SupportResistanceResult {
  // Edge case: insufficient data
  if (candles.length < 2) return NULL_RESULT;

  const windowSize = options?.windowSize ?? 10;

  // Step 1: Extract weighted price candidates (last N candles max)
  const recent = candles.slice(-windowSize);
  const candidates: Candidate[] = [];

  for (let i = recent.length - 1; i >= 0; i--) {
    const candle = recent[i];
    const daysAgo = recent.length - 1 - i;
    const recency = Math.exp(-daysAgo / 5);

    candidates.push(
      { price: candle.high, weight: 1.0 * recency },
      { price: candle.low, weight: 1.0 * recency },
      { price: candle.close, weight: 0.6 * recency },
    );
  }

  // Step 2: Filter by ±5% of currentPrice
  const filtered = candidates.filter(
    (c) => Math.abs(c.price - currentPrice) / currentPrice <= 0.05,
  );
  if (filtered.length === 0) return NULL_RESULT;

  // Step 3: Compute ATR-based cluster threshold
  const trueRanges: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    if (i === 0) {
      trueRanges.push(c.high - c.low);
    } else {
      const prevClose = recent[i - 1].close;
      trueRanges.push(
        Math.max(
          c.high - c.low,
          Math.abs(c.high - prevClose),
          Math.abs(c.low - prevClose),
        ),
      );
    }
  }
  const atr = trueRanges.reduce((s, v) => s + v, 0) / trueRanges.length;
  const threshold = Math.max(atr * 0.5, currentPrice * 0.007);

  // Step 4: Weighted clustering
  const sorted = [...filtered].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];

  for (const cand of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(cand.price - last.level) <= threshold) {
      // Merge into existing cluster
      const newWeightSum = last.weightSum + cand.weight;
      last.level =
        (last.level * last.weightSum + cand.price * cand.weight) / newWeightSum;
      last.weightSum = newWeightSum;
      last.touches += 1;
      last.min = Math.min(last.min, cand.price);
      last.max = Math.max(last.max, cand.price);
    } else {
      // Start new cluster
      clusters.push({
        level: cand.price,
        touches: 1,
        weightSum: cand.weight,
        min: cand.price,
        max: cand.price,
      });
    }
  }

  // Step 5: Filter — keep clusters with touches >= 2
  const significant = clusters.filter((c) => c.touches >= 2);
  if (significant.length === 0) return NULL_RESULT;

  // Step 5.5: Post-cluster ±5% filter — cluster averages can drift outside range
  const relevant = significant.filter(
    (c) => Math.abs(c.level - currentPrice) / currentPrice <= 0.05,
  );
  if (relevant.length === 0) return NULL_RESULT;

  // Step 6: Classify
  const supportClusters = relevant.filter((c) => c.level < currentPrice);
  const resistanceClusters = relevant.filter((c) => c.level > currentPrice);

  // Step 7: Score each cluster
  function score(cluster: Cluster): number {
    const distance = Math.abs(cluster.level - currentPrice);
    return cluster.weightSum / Math.max(distance, currentPrice * 0.001);
  }

  // Step 8: Select best
  function bestCluster(arr: Cluster[]): Cluster | null {
    if (arr.length === 0) return null;
    let best = arr[0];
    let bestScore = score(best);
    for (let i = 1; i < arr.length; i++) {
      const s = score(arr[i]);
      if (s > bestScore) {
        best = arr[i];
        bestScore = s;
      }
    }
    return best;
  }

  let bestSupport = bestCluster(supportClusters);
  let bestResistance = bestCluster(resistanceClusters);

  // Final safety: ensure selected levels are within ±5% of current price
  if (bestSupport && Math.abs(bestSupport.level - currentPrice) / currentPrice > 0.05) {
    bestSupport = null;
  }
  if (bestResistance && Math.abs(bestResistance.level - currentPrice) / currentPrice > 0.05) {
    bestResistance = null;
  }

  // Reaction context: is price approaching or rejecting a level?
  const prevClose = recent[recent.length - 2].close;
  const movingUp = currentPrice > prevClose;
  const movingDown = currentPrice < prevClose;

  // Step 9 & 10: Build zones with capped width and trader context
  function buildZone(
    cluster: Cluster,
    side: "support" | "resistance",
  ): SRZone {
    const zoneCap = Math.max(atr * 0.15, currentPrice * 0.002);
    const min = Math.max(cluster.min, cluster.level - zoneCap);
    const max = Math.min(cluster.max, cluster.level + zoneCap);

    const distancePercent =
      (Math.abs(cluster.level - currentPrice) / currentPrice) * 100;
    const proximity: Proximity =
      distancePercent <= 0.5 ? "VERY_CLOSE" : distancePercent <= 1 ? "NEAR" : "FAR";

    const strength = score(cluster);
    const confidence = cluster.weightSum;
    const zoneScore = strength * confidence;
    const isActionable = proximity === "VERY_CLOSE" || proximity === "NEAR";

    // Reaction: approaching toward level or rejecting away from it
    let reaction: Reaction = "NEUTRAL";
    if (side === "resistance") {
      if (movingUp && currentPrice < cluster.level) reaction = "APPROACHING";
      else if (movingDown && currentPrice < cluster.level) reaction = "REJECTING";
    } else {
      if (movingDown && currentPrice > cluster.level) reaction = "APPROACHING";
      else if (movingUp && currentPrice > cluster.level) reaction = "REJECTING";
    }

    // Direction hint derived from reaction + side
    let directionHint: DirectionHint = "NEUTRAL";
    if (side === "support" && reaction === "REJECTING") directionHint = "BULLISH";
    if (side === "resistance" && reaction === "REJECTING") directionHint = "BEARISH";

    return {
      min,
      max,
      level: cluster.level,
      touches: cluster.touches,
      strength,
      confidence,
      distancePercent,
      proximity,
      reaction,
      zoneScore,
      isActionable,
      directionHint,
    };
  }

  const supportZone = bestSupport ? buildZone(bestSupport, "support") : null;
  const resistanceZone = bestResistance ? buildZone(bestResistance, "resistance") : null;

  return {
    support: bestSupport ? bestSupport.level : null,
    resistance: bestResistance ? bestResistance.level : null,
    supportZone,
    resistanceZone,
    summary: {
      hasNearbySupport: supportZone?.isActionable ?? false,
      hasNearbyResistance: resistanceZone?.isActionable ?? false,
    },
  };
}
