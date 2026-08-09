import { pool } from "../db/pool.js";
import { getEventsSince } from "./events.js";
import type { MetricType, RollingMetric, StoreEvent } from "../types/index.js";

const WINDOWS = [15, 60] as const;

export interface MetricSnapshot {
  order_velocity: number;
  prep_time: number;
  cancellation_rate: number;
  handoff_delay: number;
  order_count: number;
  cancellation_count: number;
  prep_samples: number;
  handoff_samples: number;
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

export function computeMetricsFromEvents(
  events: StoreEvent[],
  windowMinutes: number,
): MetricSnapshot {
  const orders = events.filter((e) => e.type === "order");
  const cancellations = events.filter((e) => e.type === "cancellation");
  const preps = events.filter((e) => e.type === "prep_complete");
  const handoffs = events.filter((e) => e.type === "handoff");

  const orderVelocity =
    windowMinutes > 0 ? orders.length / windowMinutes : 0;

  const prepValues = preps
    .map((e) => num(e.payload, "prepMinutes"))
    .filter((v): v is number => v !== null);
  const prepTime =
    prepValues.length > 0
      ? prepValues.reduce((a, b) => a + b, 0) / prepValues.length
      : 0;

  const handoffValues = handoffs
    .map((e) => num(e.payload, "delayMinutes"))
    .filter((v): v is number => v !== null);
  const handoffDelay =
    handoffValues.length > 0
      ? handoffValues.reduce((a, b) => a + b, 0) / handoffValues.length
      : 0;

  const cancellationRate =
    orders.length > 0 ? cancellations.length / orders.length : 0;

  return {
    order_velocity: round4(orderVelocity),
    prep_time: round4(prepTime),
    cancellation_rate: round4(cancellationRate),
    handoff_delay: round4(handoffDelay),
    order_count: orders.length,
    cancellation_count: cancellations.length,
    prep_samples: prepValues.length,
    handoff_samples: handoffValues.length,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export async function upsertRollingMetric(
  storeId: string,
  metric: MetricType,
  windowMinutes: number,
  value: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO rolling_metrics (store_id, metric, window_minutes, value, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (store_id, metric, window_minutes)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [storeId, metric, windowMinutes, JSON.stringify(value)],
  );
}

export async function updateRollingMetrics(storeId: string): Promise<{
  short: MetricSnapshot;
  long: MetricSnapshot;
}> {
  const now = Date.now();
  const shortSince = new Date(now - 15 * 60_000);
  const longSince = new Date(now - 60 * 60_000);

  const [shortEvents, longEvents] = await Promise.all([
    getEventsSince(storeId, shortSince),
    getEventsSince(storeId, longSince),
  ]);

  const short = computeMetricsFromEvents(shortEvents, 15);
  const long = computeMetricsFromEvents(longEvents, 60);

  const metrics: MetricType[] = [
    "order_velocity",
    "prep_time",
    "cancellation_rate",
    "handoff_delay",
  ];

  for (const metric of metrics) {
    await upsertRollingMetric(storeId, metric, 15, {
      value: short[metric],
      ...pickCounts(short),
    });
    await upsertRollingMetric(storeId, metric, 60, {
      value: long[metric],
      ...pickCounts(long),
    });
  }

  // Convenience aggregate row for detectors / UI
  await upsertRollingMetric(storeId, "order_velocity", 15, {
    value: short.order_velocity,
    snapshot: short,
  });

  return { short, long };
}

function pickCounts(s: MetricSnapshot) {
  return {
    order_count: s.order_count,
    cancellation_count: s.cancellation_count,
    prep_samples: s.prep_samples,
    handoff_samples: s.handoff_samples,
  };
}

export async function getRollingMetric(
  storeId: string,
  metric: MetricType,
  windowMinutes: number,
): Promise<RollingMetric | null> {
  const result = await pool.query<{
    store_id: string;
    metric: string;
    window_minutes: number;
    value: Record<string, unknown>;
    updated_at: Date;
  }>(
    `SELECT store_id, metric, window_minutes, value, updated_at
     FROM rolling_metrics
     WHERE store_id = $1 AND metric = $2 AND window_minutes = $3`,
    [storeId, metric, windowMinutes],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    storeId: row.store_id,
    metric: row.metric as MetricType,
    windowMinutes: row.window_minutes,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

export { WINDOWS };
