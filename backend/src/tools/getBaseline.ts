import { z } from "zod";
import { computeMetricsFromEvents } from "../services/metrics.js";
import { getEventsSince } from "../services/events.js";
import type { MetricType } from "../types/index.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  metric: z.enum([
    "order_velocity",
    "prep_time",
    "cancellation_rate",
    "handoff_delay",
  ]),
});

/** Demo-safe defaults when historical data is thin. */
const FALLBACK_BASELINE: Record<MetricType, { mean: number; stddev: number }> = {
  order_velocity: { mean: 0.25, stddev: 0.08 },
  prep_time: { mean: 12, stddev: 3 },
  cancellation_rate: { mean: 0.04, stddev: 0.02 },
  handoff_delay: { mean: 4, stddev: 1.5 },
};

export async function getBaseline(raw: unknown) {
  const input = inputSchema.parse(raw);
  const metric = input.metric as MetricType;

  // Use last 7 days if present; for hackathon demos most data is recent —
  // also compute 60m as "normal" and compare to fallback.
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const events = await getEventsSince(input.storeId, since7d);
  const windowMinutes = Math.max(
    60,
    Math.round((Date.now() - since7d.getTime()) / 60_000),
  );
  const snap = computeMetricsFromEvents(events, Math.min(windowMinutes, 7 * 24 * 60));
  const fallback = FALLBACK_BASELINE[metric];
  const observed = snap[metric];
  const thin =
    (metric === "order_velocity" && snap.order_count < 20) ||
    (metric === "prep_time" && snap.prep_samples < 10) ||
    (metric === "cancellation_rate" && snap.order_count < 20) ||
    (metric === "handoff_delay" && snap.handoff_samples < 10);

  const mean = thin ? fallback.mean : observed;
  const stddev = thin ? fallback.stddev : Math.max(observed * 0.15, fallback.stddev * 0.5);

  return {
    storeId: input.storeId,
    metric,
    mean: round4(mean),
    stddev: round4(stddev),
    low: round4(Math.max(0, mean - stddev)),
    high: round4(mean + stddev),
    sampleSize: snap.order_count,
    thinData: thin,
    source: thin ? "fallback_baseline" : "observed_events",
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
