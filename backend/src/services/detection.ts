import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import type { Incident, IncidentStatus, IncidentType } from "../types/index.js";
import { getEventsSince } from "./events.js";
import { deriveKitchenState } from "./kitchenState.js";
import {
  type MetricSnapshot,
  updateRollingMetrics,
} from "./metrics.js";

const OPEN_STATUSES: IncidentStatus[] = [
  "DETECTED",
  "INVESTIGATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
];

export interface OverloadResult {
  overloaded: boolean;
  reasons: string[];
  short: MetricSnapshot;
  long: MetricSnapshot;
  velocitySpike: number;
  kitchenRootCause?: string;
}

interface IncidentRow {
  id: string;
  store_id: string;
  type: string;
  status: string;
  baseline: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    storeId: row.store_id,
    type: row.type as IncidentType,
    status: row.status as IncidentStatus,
    baseline: row.baseline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function checkOverloadThresholds(
  storeId: string,
): Promise<OverloadResult> {
  const { short, long } = await updateRollingMetrics(storeId);
  const recent = await getEventsSince(storeId, new Date(Date.now() - 60 * 60_000));
  const kitchen = deriveKitchenState(recent);

  const reasons: string[] = [];
  const baselineVelocity = Math.max(long.order_velocity, 0.05);
  const velocitySpike = short.order_velocity / baselineVelocity;

  if (velocitySpike >= env.THRESHOLD_ORDER_VELOCITY_SPIKE && short.order_count >= 3) {
    reasons.push(
      `order_velocity spike ${velocitySpike.toFixed(2)}x (short=${short.order_velocity}/min, baseline=${baselineVelocity}/min)`,
    );
  }

  if (
    short.prep_time >= env.THRESHOLD_PREP_TIME_MINUTES &&
    short.prep_samples >= 2
  ) {
    reasons.push(
      `prep_time ${short.prep_time.toFixed(1)}m >= ${env.THRESHOLD_PREP_TIME_MINUTES}m`,
    );
  }

  if (
    short.cancellation_rate >= env.THRESHOLD_CANCEL_RATE &&
    short.order_count >= 3
  ) {
    reasons.push(
      `cancellation_rate ${(short.cancellation_rate * 100).toFixed(1)}% >= ${(env.THRESHOLD_CANCEL_RATE * 100).toFixed(0)}%`,
    );
  }

  if (
    short.handoff_delay >= env.THRESHOLD_HANDOFF_DELAY_MINUTES &&
    short.handoff_samples >= 2
  ) {
    reasons.push(
      `handoff_delay ${short.handoff_delay.toFixed(1)}m >= ${env.THRESHOLD_HANDOFF_DELAY_MINUTES}m`,
    );
  }

  if (kitchen.stockouts.length > 0) {
    reasons.push(
      `inventory_shortage: ${kitchen.stockouts.map((s) => s.name || s.sku).join(", ")} onHand=0`,
    );
  }
  if (
    kitchen.staffingStatus === "shortfall" ||
    (kitchen.cooksOnFloor != null &&
      kitchen.cooksRequired != null &&
      kitchen.cooksOnFloor < kitchen.cooksRequired)
  ) {
    reasons.push(
      `staffing_shortfall: ${kitchen.cooksOnFloor}/${kitchen.cooksRequired} cooks on floor`,
    );
  }
  if (kitchen.deliveryOversell.length > 0) {
    const d = kitchen.deliveryOversell[0];
    reasons.push(
      `delivery_oversell: ${d.channel} accepted ${d.accepted} vs slot cap ${d.kitchenSlotCap}`,
    );
  }

  // Classic overload = ≥2 signals. Meghana root-cause paths also fire with
  // one kitchen-truth signal + one operational symptom (cancel/prep/handoff).
  const kitchenReasons = reasons.filter(
    (r) =>
      r.startsWith("inventory_shortage") ||
      r.startsWith("staffing_shortfall") ||
      r.startsWith("delivery_oversell"),
  );
  const opsReasons = reasons.filter((r) => !kitchenReasons.includes(r));
  const overloaded =
    reasons.length >= 2 ||
    (kitchenReasons.length >= 1 && opsReasons.length >= 1);

  return {
    overloaded,
    reasons,
    short,
    long,
    velocitySpike,
    kitchenRootCause: kitchen.inferredRootCause,
  };
}

export async function hasOpenIncident(
  storeId: string,
  type: IncidentType = "operational_overload",
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM incidents
     WHERE store_id = $1 AND type = $2 AND status = ANY($3::text[])
     LIMIT 1`,
    [storeId, type, OPEN_STATUSES],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createIncident(
  storeId: string,
  overload: OverloadResult,
): Promise<Incident | null> {
  if (await hasOpenIncident(storeId)) {
    return null;
  }

  const baseline = {
    detectedAt: new Date().toISOString(),
    brand: "Meghana Biryani",
    reasons: overload.reasons,
    velocitySpike: overload.velocitySpike,
    kitchenRootCause: overload.kitchenRootCause ?? null,
    metrics_15m: overload.short,
    metrics_60m: overload.long,
    thresholds: {
      orderVelocitySpike: env.THRESHOLD_ORDER_VELOCITY_SPIKE,
      prepTimeMinutes: env.THRESHOLD_PREP_TIME_MINUTES,
      cancelRate: env.THRESHOLD_CANCEL_RATE,
      handoffDelayMinutes: env.THRESHOLD_HANDOFF_DELAY_MINUTES,
    },
  };

  const result = await pool.query<IncidentRow>(
    `INSERT INTO incidents (store_id, type, status, baseline)
     VALUES ($1, $2, 'DETECTED', $3::jsonb)
     RETURNING id, store_id, type, status, baseline, created_at, updated_at`,
    [storeId, "operational_overload", JSON.stringify(baseline)],
  );

  const incident = mapIncident(result.rows[0]);
  console.log(
    `[detection] incident ${incident.id} DETECTED for ${storeId}: ${overload.reasons.join("; ")}`,
  );
  return incident;
}

export async function listIncidents(limit = 50): Promise<Incident[]> {
  const result = await pool.query<IncidentRow>(
    `SELECT id, store_id, type, status, baseline, created_at, updated_at
     FROM incidents
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapIncident);
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const result = await pool.query<IncidentRow>(
    `SELECT id, store_id, type, status, baseline, created_at, updated_at
     FROM incidents
     WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapIncident(row) : null;
}

export async function detectForStore(storeId: string): Promise<Incident | null> {
  const overload = await checkOverloadThresholds(storeId);
  if (!overload.overloaded) {
    return null;
  }
  return createIncident(storeId, overload);
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
): Promise<Incident | null> {
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents
     SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, store_id, type, status, baseline, created_at, updated_at`,
    [id, status],
  );
  const row = result.rows[0];
  return row ? mapIncident(row) : null;
}

/** Atomically claim the next DETECTED incident for investigation. */
export async function claimNextDetectedIncident(): Promise<Incident | null> {
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents
     SET status = 'INVESTIGATING', updated_at = NOW()
     WHERE id = (
       SELECT id FROM incidents
       WHERE status = 'DETECTED'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, store_id, type, status, baseline, created_at, updated_at`,
  );
  const row = result.rows[0];
  return row ? mapIncident(row) : null;
}


/** Mark open incidents RESOLVED so a new demo run can create a fresh DETECTED row. */
export async function resolveOpenIncidents(
  storeId: string,
): Promise<{ id: string; status: IncidentStatus }[]> {
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents
     SET status = 'RESOLVED', updated_at = NOW()
     WHERE store_id = $1 AND status = ANY($2::text[])
     RETURNING id, store_id, type, status, baseline, created_at, updated_at`,
    [storeId, OPEN_STATUSES],
  );
  return result.rows.map((row) => ({
    id: row.id,
    status: row.status as IncidentStatus,
  }));
}

/** Wipe store events + rolling metrics for a clean replay. */
export async function wipeStoreDemoData(storeId: string): Promise<{
  eventsDeleted: number;
  metricsDeleted: number;
}> {
  const events = await pool.query(`DELETE FROM events WHERE store_id = $1`, [storeId]);
  const metrics = await pool.query(
    `DELETE FROM rolling_metrics WHERE store_id = $1`,
    [storeId],
  );
  return {
    eventsDeleted: events.rowCount ?? 0,
    metricsDeleted: metrics.rowCount ?? 0,
  };
}

