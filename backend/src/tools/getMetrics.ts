import { z } from "zod";
import { env } from "../config/env.js";
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
  windowMinutes: z.number().positive().max(180).optional().default(15),
});

export async function getMetrics(raw: unknown) {
  const input = inputSchema.parse(raw);
  const since = new Date(Date.now() - input.windowMinutes * 60_000);
  const events = await getEventsSince(input.storeId, since);
  const snapshot = computeMetricsFromEvents(events, input.windowMinutes);
  const metric = input.metric as MetricType;

  // Bucket roughly into 5 time slices for a simple series
  const bucketMinutes = Math.max(1, Math.floor(input.windowMinutes / 5));
  const series: { at: string; value: number }[] = [];
  for (let i = 5; i >= 1; i -= 1) {
    const endOffset = (i - 1) * bucketMinutes;
    const startOffset = i * bucketMinutes;
    const bucketStart = new Date(Date.now() - startOffset * 60_000);
    const bucketEnd = new Date(Date.now() - endOffset * 60_000);
    const bucketEvents = events.filter(
      (e) => e.occurredAt >= bucketStart && e.occurredAt < bucketEnd,
    );
    const bucketSnap = computeMetricsFromEvents(bucketEvents, bucketMinutes);
    series.push({
      at: bucketEnd.toISOString(),
      value: bucketSnap[metric],
    });
  }

  return {
    storeId: input.storeId,
    metric,
    windowMinutes: input.windowMinutes,
    current: snapshot[metric],
    snapshot,
    series,
    thresholds: {
      orderVelocitySpike: env.THRESHOLD_ORDER_VELOCITY_SPIKE,
      prepTimeMinutes: env.THRESHOLD_PREP_TIME_MINUTES,
      cancelRate: env.THRESHOLD_CANCEL_RATE,
      handoffDelayMinutes: env.THRESHOLD_HANDOFF_DELAY_MINUTES,
    },
  };
}
