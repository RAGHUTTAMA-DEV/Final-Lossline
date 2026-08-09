import { pool } from "../db/pool.js";
import {
  getPortfolio,
  getPortfolioStore,
  type PortfolioStore,
} from "../portfolio/stores.js";
import { getDailyActivity, getEventsSince } from "./events.js";
import {
  getMetricsForUi,
  queryMetricsWindow,
  type MetricSnapshot,
} from "./metrics.js";
import { deriveKitchenState } from "./kitchenState.js";
import { createLLMClient } from "../llm/index.js";
import { listIncidents } from "./detection.js";

export interface ReviewAgg {
  count: number;
  avgRating: number;
  lowStarPct: number;
  recent: Array<{ rating: number; text: string; at: string; channel?: string }>;
  daily: Array<{ date: string; avgRating: number; count: number }>;
}

export interface LocationHeadline {
  storeId: string;
  name: string;
  area: string;
  icon: string;
  lat: number;
  lng: number;
  seeded: boolean;
  rating: number;
  reviewCount: number;
  cancelRate: number;
  prepTime: number;
  orderVelocity: number;
  stockoutCount: number;
  activeIncidents: number;
  estimatedExposure: number;
}

export interface LocationAnalytics {
  store: PortfolioStore;
  seeded: boolean;
  days: number;
  metrics: { "15m": MetricSnapshot; "60m": MetricSnapshot };
  activity: Awaited<ReturnType<typeof getDailyActivity>>;
  reviews: ReviewAgg;
  inventory: ReturnType<typeof deriveKitchenState>["inventory"];
  stockouts: ReturnType<typeof deriveKitchenState>["stockouts"];
  staffing: {
    cooksOnFloor: number | null;
    cooksRequired: number | null;
    status: string | null;
  };
  activeIncidents: number;
}

export interface CompareReason {
  metric: string;
  a: number;
  b: number;
  impact: "high" | "medium" | "low";
  note: string;
  favors: "a" | "b" | "tie";
}

export interface LocationCompare {
  a: LocationHeadline;
  b: LocationHeadline;
  winner: string | null;
  scoreA: number;
  scoreB: number;
  scoreDelta: number;
  reasons: CompareReason[];
  narrative: string | null;
}

function ymd(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function numPayload(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = payload[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

export async function aggregateReviews(
  storeId: string,
  days = 7,
): Promise<ReviewAgg> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const result = await pool.query<{
    occurred_at: Date;
    payload: Record<string, unknown>;
  }>(
    `SELECT occurred_at, payload
     FROM events
     WHERE store_id = $1 AND type = 'review' AND occurred_at >= $2
     ORDER BY occurred_at DESC`,
    [storeId, since],
  );

  const ratings: number[] = [];
  const recent: ReviewAgg["recent"] = [];
  const byDay = new Map<string, number[]>();

  for (const row of result.rows) {
    const rating = numPayload(row.payload, "rating", "stars");
    if (rating == null) continue;
    ratings.push(rating);
    const day = ymd(row.occurred_at);
    const bucket = byDay.get(day) ?? [];
    bucket.push(rating);
    byDay.set(day, bucket);

    if (recent.length < 8) {
      recent.push({
        rating,
        text:
          typeof row.payload.text === "string"
            ? row.payload.text
            : typeof row.payload.comment === "string"
              ? row.payload.comment
              : `${rating}★ review`,
        at: row.occurred_at.toISOString(),
        channel:
          typeof row.payload.channel === "string"
            ? row.payload.channel
            : undefined,
      });
    }
  }

  const count = ratings.length;
  const avgRating =
    count > 0 ? ratings.reduce((s, n) => s + n, 0) / count : 0;
  const lowStarPct =
    count > 0 ? ratings.filter((r) => r <= 2).length / count : 0;

  const daily: ReviewAgg["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = ymd(d);
    const vals = byDay.get(key) ?? [];
    daily.push({
      date: key,
      count: vals.length,
      avgRating:
        vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0,
    });
  }

  return {
    count,
    avgRating: Math.round(avgRating * 100) / 100,
    lowStarPct: Math.round(lowStarPct * 1000) / 1000,
    recent,
    daily,
  };
}

async function activeIncidentCount(
  storeId: string,
  incidents?: Awaited<ReturnType<typeof listIncidents>>,
): Promise<number> {
  const open = new Set([
    "DETECTED",
    "INVESTIGATING",
    "AWAITING_APPROVAL",
    "APPROVED",
    "EXECUTING",
    "VERIFYING",
  ]);
  const all = incidents ?? (await listIncidents(200));
  return all.filter((i) => i.storeId === storeId && open.has(i.status)).length;
}

export async function getLocationHeadline(
  store: PortfolioStore,
  incidents?: Awaited<ReturnType<typeof listIncidents>>,
): Promise<LocationHeadline> {
  if (!store.seeded) {
    return {
      storeId: store.id,
      name: store.name,
      area: store.area,
      icon: store.icon,
      lat: store.lat,
      lng: store.lng,
      seeded: false,
      rating: store.demoRating,
      reviewCount: 0,
      cancelRate: 0,
      prepTime: 0,
      orderVelocity: 0,
      stockoutCount: 0,
      activeIncidents:
        store.demoRisk === "CRITICAL" ? 2 : store.demoRisk === "HIGH" ? 1 : 0,
      estimatedExposure:
        store.demoRisk === "CRITICAL"
          ? 48200
          : store.demoRisk === "HIGH"
            ? 21000
            : 0,
    };
  }

  const [reviews, dayMetrics, stockouts, active] = await Promise.all([
    aggregateReviews(store.id, 7),
    queryMetricsWindow(store.id, 24 * 60),
    (async () => {
      const result = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM events
         WHERE store_id = $1 AND type = 'inventory_snapshot'
         ORDER BY occurred_at DESC LIMIT 1`,
        [store.id],
      );
      const items = result.rows[0]?.payload?.items;
      if (!Array.isArray(items)) return 0;
      return items.filter((i) => {
        if (!i || typeof i !== "object") return false;
        const row = i as { onHand?: unknown; status?: unknown };
        return Number(row.onHand) <= 0 || row.status === "stockout";
      }).length;
    })(),
    activeIncidentCount(store.id, incidents),
  ]);

  return {
    storeId: store.id,
    name: store.name,
    area: store.area,
    icon: store.icon,
    lat: store.lat,
    lng: store.lng,
    seeded: true,
    rating: reviews.count > 0 ? reviews.avgRating : store.demoRating,
    reviewCount: reviews.count,
    cancelRate: dayMetrics.cancellation_rate,
    prepTime: dayMetrics.prep_time,
    orderVelocity: dayMetrics.order_velocity,
    stockoutCount: stockouts,
    activeIncidents: active,
    estimatedExposure: 0,
  };
}

export async function listLocationHeadlines(): Promise<LocationHeadline[]> {
  const incidents = await listIncidents(200);
  return Promise.all(
    getPortfolio().map((store) => getLocationHeadline(store, incidents)),
  );
}

export async function getLocationAnalytics(
  storeId: string,
  days = 7,
): Promise<LocationAnalytics | null> {
  const store = getPortfolioStore(storeId);
  if (!store) return null;

  const safeDays = Math.min(Math.max(days, 1), 30);

  if (!store.seeded) {
    return {
      store,
      seeded: false,
      days: safeDays,
      metrics: {
        "15m": emptyMetrics(),
        "60m": emptyMetrics(),
      },
      activity: await getDailyActivity(store.id, safeDays),
      reviews: {
        count: 0,
        avgRating: store.demoRating,
        lowStarPct: 0,
        recent: [],
        daily: [],
      },
      inventory: [],
      stockouts: [],
      staffing: { cooksOnFloor: null, cooksRequired: null, status: null },
      activeIncidents: 0,
    };
  }

  const [{ short, long }, activity, reviews, recentEvents, active] =
    await Promise.all([
      getMetricsForUi(store.id),
      getDailyActivity(store.id, safeDays),
      aggregateReviews(store.id, safeDays),
      getEventsSince(store.id, new Date(Date.now() - 2 * 60 * 60_000)),
      activeIncidentCount(store.id),
    ]);

  const kitchen = deriveKitchenState(recentEvents);

  return {
    store,
    seeded: true,
    days: safeDays,
    metrics: { "15m": short, "60m": long },
    activity,
    reviews,
    inventory: kitchen.inventory,
    stockouts: kitchen.stockouts,
    staffing: {
      cooksOnFloor: kitchen.cooksOnFloor,
      cooksRequired: kitchen.cooksRequired,
      status: kitchen.staffingStatus,
    },
    activeIncidents: active,
  };
}

function emptyMetrics(): MetricSnapshot {
  return {
    order_velocity: 0,
    prep_time: 0,
    cancellation_rate: 0,
    handoff_delay: 0,
    order_count: 0,
    cancellation_count: 0,
    prep_samples: 0,
    handoff_samples: 0,
  };
}

/** Higher is better operational health score (0–100). */
export function healthScore(h: LocationHeadline): number {
  const reviewScore = Math.min(5, Math.max(0, h.rating)) * 12; // 0–60
  const cancelPenalty = Math.min(25, h.cancelRate * 100 * 1.2);
  const prepPenalty = Math.min(20, Math.max(0, h.prepTime - 14) * 1.5);
  const stockPenalty = Math.min(15, h.stockoutCount * 7);
  const incidentPenalty = Math.min(15, h.activeIncidents * 8);
  return Math.round(
    Math.max(
      0,
      Math.min(100, reviewScore + 40 - cancelPenalty - prepPenalty - stockPenalty - incidentPenalty),
    ),
  );
}

function buildReasons(
  a: LocationHeadline,
  b: LocationHeadline,
): CompareReason[] {
  const reasons: CompareReason[] = [];

  const ratingDiff = a.rating - b.rating;
  reasons.push({
    metric: "review_avg",
    a: a.rating,
    b: b.rating,
    impact: Math.abs(ratingDiff) >= 0.4 ? "high" : Math.abs(ratingDiff) >= 0.15 ? "medium" : "low",
    note:
      ratingDiff === 0
        ? "Similar average ratings"
        : `${ratingDiff > 0 ? a.name : b.name} avg rating ${
            ratingDiff > 0 ? "+" : ""
          }${ratingDiff.toFixed(2)}`,
    favors: ratingDiff > 0.05 ? "a" : ratingDiff < -0.05 ? "b" : "tie",
  });

  const cancelDiffAbs = Math.abs(a.cancelRate - b.cancelRate);
  reasons.push({
    metric: "cancel_rate",
    a: a.cancelRate,
    b: b.cancelRate,
    impact:
      cancelDiffAbs >= 0.05 ? "high" : cancelDiffAbs >= 0.02 ? "medium" : "low",
    note:
      cancelDiffAbs < 0.01
        ? "Similar cancellation rates"
        : `${a.cancelRate < b.cancelRate ? a.name : b.name} has fewer cancellations (${(
            Math.min(a.cancelRate, b.cancelRate) * 100
          ).toFixed(1)}% vs ${(Math.max(a.cancelRate, b.cancelRate) * 100).toFixed(1)}%)`,
    favors: a.cancelRate < b.cancelRate - 0.01 ? "a" : b.cancelRate < a.cancelRate - 0.01 ? "b" : "tie",
  });

  reasons.push({
    metric: "prep_time",
    a: a.prepTime,
    b: b.prepTime,
    impact:
      Math.abs(a.prepTime - b.prepTime) >= 6
        ? "high"
        : Math.abs(a.prepTime - b.prepTime) >= 3
          ? "medium"
          : "low",
    note:
      Math.abs(a.prepTime - b.prepTime) < 1
        ? "Similar plate times"
        : `${a.prepTime < b.prepTime ? a.name : b.name} plates faster (${Math.min(
            a.prepTime,
            b.prepTime,
          ).toFixed(1)}m vs ${Math.max(a.prepTime, b.prepTime).toFixed(1)}m)`,
    favors: a.prepTime < b.prepTime - 0.5 ? "a" : b.prepTime < a.prepTime - 0.5 ? "b" : "tie",
  });

  reasons.push({
    metric: "stockouts",
    a: a.stockoutCount,
    b: b.stockoutCount,
    impact:
      Math.abs(a.stockoutCount - b.stockoutCount) >= 2
        ? "high"
        : Math.abs(a.stockoutCount - b.stockoutCount) >= 1
          ? "medium"
          : "low",
    note:
      a.stockoutCount === b.stockoutCount
        ? "Same stockout count on hero SKUs"
        : `${a.stockoutCount < b.stockoutCount ? a.name : b.name} has healthier inventory (${Math.min(
            a.stockoutCount,
            b.stockoutCount,
          )} vs ${Math.max(a.stockoutCount, b.stockoutCount)} stockouts)`,
    favors:
      a.stockoutCount < b.stockoutCount
        ? "a"
        : b.stockoutCount < a.stockoutCount
          ? "b"
          : "tie",
  });

  reasons.push({
    metric: "order_velocity",
    a: a.orderVelocity,
    b: b.orderVelocity,
    impact: "low",
    note: `Order velocity ${a.name} ${a.orderVelocity.toFixed(2)}/min vs ${b.name} ${b.orderVelocity.toFixed(2)}/min`,
    favors: "tie",
  });

  // Rank: high impact non-ties first
  const weight = { high: 3, medium: 2, low: 1 };
  return reasons.sort((x, y) => {
    const xt = x.favors === "tie" ? 0 : weight[x.impact];
    const yt = y.favors === "tie" ? 0 : weight[y.impact];
    return yt - xt;
  });
}

function fallbackNarrative(cmp: Omit<LocationCompare, "narrative">): string {
  if (!cmp.winner) {
    return `${cmp.a.name} and ${cmp.b.name} are close on health score (${cmp.scoreA} vs ${cmp.scoreB}). Top signals: ${cmp.reasons
      .slice(0, 2)
      .map((r) => r.note)
      .join("; ")}.`;
  }
  const winnerName = cmp.winner === cmp.a.storeId ? cmp.a.name : cmp.b.name;
  const loserName = cmp.winner === cmp.a.storeId ? cmp.b.name : cmp.a.name;
  const top = cmp.reasons.filter((r) => r.favors !== "tie").slice(0, 3);
  return `${winnerName} is ahead of ${loserName} (score ${Math.max(
    cmp.scoreA,
    cmp.scoreB,
  )} vs ${Math.min(cmp.scoreA, cmp.scoreB)}). Why: ${top.map((r) => r.note).join("; ")}.`;
}

async function maybeNarrative(
  cmp: Omit<LocationCompare, "narrative">,
): Promise<string> {
  try {
    const llm = createLLMClient();
    const system = [
      "You explain Meghana Biryani outlet comparisons for ops managers.",
      "Use ONLY the JSON reasons/scores. 2–3 short sentences. No invented metrics.",
      "Currency INR if needed. Be concrete.",
    ].join(" ");
    const response = await llm.chat({
      system,
      messages: [
        {
          role: "user",
          content: `Explain why one outlet is doing better:\n${JSON.stringify({
            a: cmp.a.name,
            b: cmp.b.name,
            winner: cmp.winner,
            scoreA: cmp.scoreA,
            scoreB: cmp.scoreB,
            reasons: cmp.reasons.slice(0, 4),
          })}`,
        },
      ],
    });
    const text = response.text?.trim();
    if (text) return text;
  } catch {
    /* fallback */
  }
  return fallbackNarrative(cmp);
}

export async function compareLocations(
  storeIdA: string,
  storeIdB: string,
  withNarrative = true,
): Promise<LocationCompare | null> {
  const storeA = getPortfolioStore(storeIdA);
  const storeB = getPortfolioStore(storeIdB);
  if (!storeA || !storeB) return null;

  const [a, b] = await Promise.all([
    getLocationHeadline(storeA),
    getLocationHeadline(storeB),
  ]);

  const scoreA = healthScore(a);
  const scoreB = healthScore(b);
  const reasons = buildReasons(a, b);

  let winner: string | null = null;
  if (scoreA >= scoreB + 3) winner = a.storeId;
  else if (scoreB >= scoreA + 3) winner = b.storeId;

  const base = {
    a,
    b,
    winner,
    scoreA,
    scoreB,
    scoreDelta: Math.abs(scoreA - scoreB),
    reasons,
  };

  const narrative = withNarrative ? await maybeNarrative(base) : fallbackNarrative(base);

  return { ...base, narrative };
}

/** Expose UI metrics helper for branches / tools. */
export async function liveMetricsForStore(storeId: string): Promise<MetricSnapshot> {
  return queryMetricsWindow(storeId, 15);
}

export async function reviewRatingForStore(storeId: string): Promise<{
  rating: number;
  count: number;
}> {
  const reviews = await aggregateReviews(storeId, 7);
  return { rating: reviews.avgRating, count: reviews.count };
}
