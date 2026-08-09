import { pool } from "../db/pool.js";
import type { MetricSnapshot } from "./metrics.js";
import type { Outcome, OutcomeVerdict } from "../types/index.js";

interface OutcomeRow {
  id: string;
  incident_id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  verdict: string;
  evaluated_at: Date;
}

function mapOutcome(row: OutcomeRow): Outcome {
  return {
    id: row.id,
    incidentId: row.incident_id,
    before: row.before,
    after: row.after,
    verdict: row.verdict as OutcomeVerdict,
    evaluatedAt: row.evaluated_at,
  };
}

export interface OutcomeEvaluation {
  verdict: OutcomeVerdict;
  improvements: string[];
  regressions: string[];
  score: number;
}

/**
 * Compare baseline (before) vs current metrics (after).
 * RESOLVED when at least 2 of the overload signals clearly improve.
 */
export function evaluateOutcome(
  before: MetricSnapshot,
  after: MetricSnapshot,
): OutcomeEvaluation {
  const improvements: string[] = [];
  const regressions: string[] = [];

  // Prep time: improve if drops by ≥15% or ≥3 minutes
  if (before.prep_time > 0) {
    const drop = before.prep_time - after.prep_time;
    const pct = drop / before.prep_time;
    if (drop >= 3 || pct >= 0.15) {
      improvements.push(
        `prep_time ${before.prep_time.toFixed(1)} → ${after.prep_time.toFixed(1)}m`,
      );
    } else if (drop < -2) {
      regressions.push(
        `prep_time worsened ${before.prep_time.toFixed(1)} → ${after.prep_time.toFixed(1)}m`,
      );
    }
  }

  // Cancellation rate: improve if absolute drop ≥3pp or relative ≥25%
  if (before.cancellation_rate > 0) {
    const drop = before.cancellation_rate - after.cancellation_rate;
    const pct = drop / before.cancellation_rate;
    if (drop >= 0.03 || pct >= 0.25) {
      improvements.push(
        `cancellation_rate ${(before.cancellation_rate * 100).toFixed(1)}% → ${(after.cancellation_rate * 100).toFixed(1)}%`,
      );
    } else if (drop < -0.02) {
      regressions.push(
        `cancellation_rate worsened ${(before.cancellation_rate * 100).toFixed(1)}% → ${(after.cancellation_rate * 100).toFixed(1)}%`,
      );
    }
  }

  // Handoff delay: improve if drops by ≥15% or ≥2 minutes
  if (before.handoff_delay > 0) {
    const drop = before.handoff_delay - after.handoff_delay;
    const pct = drop / before.handoff_delay;
    if (drop >= 2 || pct >= 0.15) {
      improvements.push(
        `handoff_delay ${before.handoff_delay.toFixed(1)} → ${after.handoff_delay.toFixed(1)}m`,
      );
    } else if (drop < -2) {
      regressions.push(
        `handoff_delay worsened ${before.handoff_delay.toFixed(1)} → ${after.handoff_delay.toFixed(1)}m`,
      );
    }
  }

  // Order velocity: improve if spike cools (≥20% drop when previously elevated)
  if (before.order_velocity > 0) {
    const drop = before.order_velocity - after.order_velocity;
    const pct = drop / before.order_velocity;
    if (pct >= 0.2) {
      improvements.push(
        `order_velocity ${before.order_velocity.toFixed(3)} → ${after.order_velocity.toFixed(3)}/min`,
      );
    } else if (pct < -0.2) {
      regressions.push(
        `order_velocity rose ${before.order_velocity.toFixed(3)} → ${after.order_velocity.toFixed(3)}/min`,
      );
    }
  }

  const score = improvements.length - regressions.length;
  const verdict: OutcomeVerdict =
    improvements.length >= 2 && score > 0 ? "RESOLVED" : "NOT_IMPROVED";

  return { verdict, improvements, regressions, score };
}

export function metricSnapshotFromBaseline(
  baseline: Record<string, unknown> | null,
): MetricSnapshot | null {
  if (!baseline) return null;
  const raw = baseline.metrics_15m;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const n = (key: string): number => {
    const v = m[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    order_velocity: n("order_velocity"),
    prep_time: n("prep_time"),
    cancellation_rate: n("cancellation_rate"),
    handoff_delay: n("handoff_delay"),
    order_count: n("order_count"),
    cancellation_count: n("cancellation_count"),
    prep_samples: n("prep_samples"),
    handoff_samples: n("handoff_samples"),
  };
}

export async function saveOutcome(input: {
  incidentId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  verdict: OutcomeVerdict;
}): Promise<Outcome> {
  const result = await pool.query<OutcomeRow>(
    `INSERT INTO outcomes (incident_id, before, after, verdict)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)
     RETURNING id, incident_id, before, after, verdict, evaluated_at`,
    [
      input.incidentId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.verdict,
    ],
  );
  return mapOutcome(result.rows[0]);
}

export async function getLatestOutcome(
  incidentId: string,
): Promise<Outcome | null> {
  const result = await pool.query<OutcomeRow>(
    `SELECT id, incident_id, before, after, verdict, evaluated_at
     FROM outcomes
     WHERE incident_id = $1
     ORDER BY evaluated_at DESC
     LIMIT 1`,
    [incidentId],
  );
  const row = result.rows[0];
  return row ? mapOutcome(row) : null;
}

/** Enough post-action samples to judge (demo-friendly thresholds). */
export function enoughDataForOutcome(after: MetricSnapshot): boolean {
  return (
    after.order_count >= 2 ||
    after.prep_samples >= 1 ||
    after.handoff_samples >= 1
  );
}
