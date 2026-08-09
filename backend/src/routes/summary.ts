import { Router } from "express";
import { env } from "../config/env.js";
import { listIncidents } from "../services/detection.js";
import { getDailyActivity } from "../services/events.js";
import { getLatestRecommendationsMap } from "../services/recommendations.js";
import { getMetricsForUi, queryMetricsWindow } from "../services/metrics.js";
import {
  getPortfolio,
  MAP_CENTER,
  primaryStoreId,
  type PortfolioStore,
  type RiskLevel,
} from "../portfolio/stores.js";
import { pool } from "../db/pool.js";

export const summaryRouter = Router();

const OPEN = new Set([
  "DETECTED",
  "INVESTIGATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
]);

function riskFromActive(count: number): RiskLevel {
  if (count >= 2) return "CRITICAL";
  if (count === 1) return "HIGH";
  return "LOW";
}

async function reviewHeadline(storeId: string): Promise<{
  rating: number;
  count: number;
}> {
  const result = await pool.query<{ count: string; avg: string | null }>(
    `SELECT
       COUNT(*)::int AS count,
       AVG(
         COALESCE(
           (payload->>'rating')::numeric,
           (payload->>'stars')::numeric
         )
       ) AS avg
     FROM events
     WHERE store_id = $1
       AND type = 'review'
       AND occurred_at >= NOW() - INTERVAL '7 days'`,
    [storeId],
  );
  const count = Number(result.rows[0]?.count) || 0;
  const avg = Number(result.rows[0]?.avg) || 0;
  return { count, rating: count > 0 ? Math.round(avg * 100) / 100 : 0 };
}

async function stockoutCount(storeId: string): Promise<number> {
  const result = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload
     FROM events
     WHERE store_id = $1 AND type = 'inventory_snapshot'
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [storeId],
  );
  const items = result.rows[0]?.payload?.items;
  if (!Array.isArray(items)) return 0;
  return items.filter((i) => {
    if (!i || typeof i !== "object") return false;
    const row = i as { onHand?: unknown; status?: unknown };
    const onHand = Number(row.onHand) || 0;
    return onHand <= 0 || row.status === "stockout";
  }).length;
}

async function buildSeededBranch(
  store: PortfolioStore,
  activeCount: number,
  exposure: number,
) {
  const [short, reviews, stockouts] = await Promise.all([
    queryMetricsWindow(store.id, 15),
    reviewHeadline(store.id),
    stockoutCount(store.id),
  ]);

  const rating = reviews.count > 0 ? reviews.rating : store.demoRating;
  const revDelta = Math.round(
    (rating - 4) * 12 -
      activeCount * 8 -
      short.cancellation_rate * 40 -
      stockouts * 5,
  );

  return {
    id: store.id,
    name: store.name,
    area: store.area,
    icon: store.icon,
    lat: store.lat,
    lng: store.lng,
    rating: Math.round(rating * 10) / 10,
    revDelta,
    risk:
      activeCount > 0
        ? riskFromActive(activeCount)
        : stockouts
          ? ("MEDIUM" as const)
          : ("LOW" as const),
    demo: false,
    seeded: true,
    activeIncidents: activeCount,
    estimatedExposure: exposure,
    metrics: {
      orderVelocity: short.order_velocity,
      prepTime: short.prep_time,
      cancelRate: short.cancellation_rate,
      handoffDelay: short.handoff_delay,
    },
  };
}

summaryRouter.get("/api/summary", async (_req, res) => {
  try {
    const incidents = await listIncidents(200);
    const active = incidents.filter((i) => OPEN.has(i.status));
    const resolved = incidents.filter((i) => i.status === "RESOLVED");
    const notImproved = incidents.filter((i) => i.status === "NOT_IMPROVED");

    const recMap = await getLatestRecommendationsMap(active.map((i) => i.id));
    let estimatedExposure = 0;
    for (const rec of recMap.values()) {
      if (rec.estimatedExposure != null) {
        estimatedExposure += Number(rec.estimatedExposure);
      }
    }

    const storeIds = [...new Set(incidents.map((i) => i.storeId))];
    if (storeIds.length === 0) storeIds.push(env.STORE_ID);

    const portfolio = getPortfolio();
    const seededAtRisk = portfolio.filter(
      (b) =>
        !b.seeded && (b.demoRisk === "CRITICAL" || b.demoRisk === "HIGH"),
    ).length;

    res.json({
      storeId: env.STORE_ID,
      stores: storeIds,
      incidentCount: incidents.length,
      activeCount: active.length,
      resolvedCount: resolved.length,
      notImprovedCount: notImproved.length,
      estimatedExposure,
      awaitingApproval: active.filter((i) => i.status === "AWAITING_APPROVAL")
        .length,
      branchesAtRisk: active.length + seededAtRisk,
    });
  } catch (err) {
    console.error("[summary] failed:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

summaryRouter.get("/api/metrics", async (req, res) => {
  try {
    const storeId =
      typeof req.query.storeId === "string" && req.query.storeId.length > 0
        ? req.query.storeId
        : env.STORE_ID;

    const { short, long } = await getMetricsForUi(storeId);
    res.json({
      storeId,
      windows: {
        "15m": short,
        "60m": long,
      },
      thresholds: {
        orderVelocitySpike: env.THRESHOLD_ORDER_VELOCITY_SPIKE,
        prepTimeMinutes: env.THRESHOLD_PREP_TIME_MINUTES,
        cancelRate: env.THRESHOLD_CANCEL_RATE,
        handoffDelayMinutes: env.THRESHOLD_HANDOFF_DELAY_MINUTES,
      },
    });
  } catch (err) {
    console.error("[metrics] failed:", err);
    res.status(500).json({ error: "Failed to load metrics" });
  }
});

summaryRouter.get("/api/activity", async (req, res) => {
  try {
    const storeId =
      typeof req.query.storeId === "string" && req.query.storeId.length > 0
        ? req.query.storeId
        : env.STORE_ID;
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 30);
    const series = await getDailyActivity(storeId, days);
    res.json({ storeId, days, series });
  } catch (err) {
    console.error("[activity] failed:", err);
    res.status(500).json({ error: "Failed to load activity" });
  }
});

summaryRouter.get("/api/branches", async (_req, res) => {
  try {
    const incidents = await listIncidents(200);
    const active = incidents.filter((i) => OPEN.has(i.status));
    const primary = primaryStoreId();
    const recMap = await getLatestRecommendationsMap(active.map((i) => i.id));

    const exposureByStore = new Map<string, number>();
    for (const inc of active) {
      const rec = recMap.get(inc.id);
      if (rec?.estimatedExposure == null) continue;
      exposureByStore.set(
        inc.storeId,
        (exposureByStore.get(inc.storeId) ?? 0) + Number(rec.estimatedExposure),
      );
    }

    const activeByStore = new Map<string, number>();
    for (const inc of active) {
      activeByStore.set(
        inc.storeId,
        (activeByStore.get(inc.storeId) ?? 0) + 1,
      );
    }

    const branches = await Promise.all(
      getPortfolio().map(async (store) => {
        if (store.seeded) {
          return buildSeededBranch(
            store,
            activeByStore.get(store.id) ?? 0,
            exposureByStore.get(store.id) ?? 0,
          );
        }
        return {
          id: store.id,
          name: store.name,
          area: store.area,
          icon: store.icon,
          lat: store.lat,
          lng: store.lng,
          rating: store.demoRating,
          revDelta: store.demoRevDelta,
          risk: store.demoRisk,
          demo: true,
          seeded: false,
          activeIncidents:
            store.demoRisk === "CRITICAL"
              ? 2
              : store.demoRisk === "HIGH"
                ? 1
                : 0,
          estimatedExposure:
            store.demoRisk === "CRITICAL"
              ? 48200
              : store.demoRisk === "HIGH"
                ? 21000
                : 0,
          metrics: null,
        };
      }),
    );

    branches.sort((x, y) => {
      if (x.id === primary) return -1;
      if (y.id === primary) return 1;
      return 0;
    });

    res.json({
      primaryStoreId: primary,
      branches,
      mapCenter: MAP_CENTER,
    });
  } catch (err) {
    console.error("[branches] failed:", err);
    res.status(500).json({ error: "Failed to load branches" });
  }
});
