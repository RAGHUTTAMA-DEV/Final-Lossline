import { Router } from "express";
import { env } from "../config/env.js";
import { listIncidents } from "../services/detection.js";
import { getDailyActivity } from "../services/events.js";
import { getLatestRecommendation } from "../services/recommendations.js";
import { updateRollingMetrics } from "../services/metrics.js";

export const summaryRouter = Router();

const OPEN = new Set([
  "DETECTED",
  "INVESTIGATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
]);

/** Companion Meghana Biryani outlets for multi-branch / map UI (primary store stays live). */
const PORTFOLIO = [
  {
    id: "meghana_indiranagar",
    name: "Indiranagar",
    area: "Meghana Biryani · 100 Feet Rd",
    icon: "🏙️",
    lat: 12.9784,
    lng: 77.6408,
    rating: 4.1,
    revDelta: -28,
    risk: "CRITICAL" as const,
    demo: true,
  },
  {
    id: "meghana_airport",
    name: "Airport",
    area: "Meghana · T2 food court",
    icon: "✈️",
    lat: 13.1986,
    lng: 77.7066,
    rating: 3.8,
    revDelta: -14,
    risk: "HIGH" as const,
    demo: true,
  },
  {
    id: "meghana_hsr",
    name: "HSR Hub",
    area: "Meghana · central kitchen",
    icon: "🏭",
    lat: 12.9116,
    lng: 77.6473,
    rating: 4.4,
    revDelta: 8,
    risk: "LOW" as const,
    demo: true,
  },
  {
    id: "meghana_jayanagar",
    name: "Jayanagar",
    area: "Meghana Biryani · 4th Block",
    icon: "🏡",
    lat: 12.9308,
    lng: 77.5838,
    rating: 4.0,
    revDelta: -6,
    risk: "MEDIUM" as const,
    demo: true,
  },
  {
    id: "meghana_whitefield",
    name: "Whitefield",
    area: "Meghana · ITPL road",
    icon: "🏢",
    lat: 12.9698,
    lng: 77.75,
    rating: 4.5,
    revDelta: 3,
    risk: "LOW" as const,
    demo: true,
  },
];

function riskFromActive(count: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (count >= 2) return "CRITICAL";
  if (count === 1) return "HIGH";
  return "LOW";
}

summaryRouter.get("/api/summary", async (_req, res) => {
  try {
    const incidents = await listIncidents(200);
    const active = incidents.filter((i) => OPEN.has(i.status));
    const resolved = incidents.filter((i) => i.status === "RESOLVED");
    const notImproved = incidents.filter((i) => i.status === "NOT_IMPROVED");

    let estimatedExposure = 0;
    for (const inc of active) {
      const rec = await getLatestRecommendation(inc.id);
      if (rec?.estimatedExposure != null) {
        estimatedExposure += Number(rec.estimatedExposure);
      }
    }

    const storeIds = [...new Set(incidents.map((i) => i.storeId))];
    if (storeIds.length === 0) storeIds.push(env.STORE_ID);

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
      branchesAtRisk:
        active.length +
        PORTFOLIO.filter((b) => b.risk === "CRITICAL" || b.risk === "HIGH")
          .length,
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

    const { short, long } = await updateRollingMetrics(storeId);
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
    const primaryActive = active.filter((i) => i.storeId === env.STORE_ID);
    const { short } = await updateRollingMetrics(env.STORE_ID);

    let exposure = 0;
    for (const inc of primaryActive) {
      const rec = await getLatestRecommendation(inc.id);
      if (rec?.estimatedExposure != null) exposure += Number(rec.estimatedExposure);
    }

    const live = {
      id: env.STORE_ID,
      name: "Koramangala",
      area: "Meghana Biryani · live kitchen",
      icon: "⚡",
      lat: 12.9352,
      lng: 77.6245,
      rating: primaryActive.length ? 3.9 : 4.3,
      revDelta: primaryActive.length ? -18 : 4,
      risk: riskFromActive(primaryActive.length),
      demo: false,
      activeIncidents: primaryActive.length,
      estimatedExposure: exposure,
      metrics: {
        orderVelocity: short.order_velocity,
        prepTime: short.prep_time,
        cancelRate: short.cancellation_rate,
        handoffDelay: short.handoff_delay,
      },
    };

    const companions = PORTFOLIO.map((b) => ({
      ...b,
      activeIncidents: b.risk === "CRITICAL" ? 2 : b.risk === "HIGH" ? 1 : 0,
      estimatedExposure:
        b.risk === "CRITICAL" ? 48200 : b.risk === "HIGH" ? 21000 : 0,
      metrics: null,
    }));

    res.json({
      primaryStoreId: env.STORE_ID,
      branches: [live, ...companions],
      mapCenter: { lat: 12.97, lng: 77.64 },
    });
  } catch (err) {
    console.error("[branches] failed:", err);
    res.status(500).json({ error: "Failed to load branches" });
  }
});
