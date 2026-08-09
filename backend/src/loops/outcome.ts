import { env } from "../config/env.js";
import { listVerifyingIncidents } from "../services/approval.js";
import { getLatestAction } from "../services/actions.js";
import { getIncidentById, updateIncidentStatus } from "../services/detection.js";
import { getEventsSince } from "../services/events.js";
import {
  computeMetricsFromEvents,
  updateRollingMetrics,
  type MetricSnapshot,
} from "../services/metrics.js";
import {
  enoughDataForOutcome,
  evaluateOutcome,
  metricSnapshotFromBaseline,
  saveOutcome,
} from "../services/outcomes.js";
import { sleep } from "../utils/sleep.js";

export interface OutcomeTickResult {
  incidentId: string;
  status: "waiting" | "RESOLVED" | "NOT_IMPROVED";
  reason?: string;
}

/**
 * Evaluate one VERIFYING incident: compare detection baseline vs
 * post-action metrics (events since executed_at).
 */
export async function evaluateVerifyingIncident(
  incidentId: string,
  opts?: { force?: boolean },
): Promise<OutcomeTickResult> {
  const incident = await getIncidentById(incidentId);
  if (!incident || incident.status !== "VERIFYING") {
    return { incidentId, status: "waiting", reason: "not_verifying" };
  }

  const action = await getLatestAction(incidentId);
  if (!action?.executedAt) {
    return { incidentId, status: "waiting", reason: "action_not_executed" };
  }

  const before = metricSnapshotFromBaseline(incident.baseline);
  if (!before) {
    return { incidentId, status: "waiting", reason: "missing_baseline" };
  }

  const elapsed = Date.now() - action.executedAt.getTime();
  const windowExpired = elapsed >= env.OUTCOME_WINDOW_MS;

  const since = action.executedAt;
  const postEvents = await getEventsSince(incident.storeId, since);
  const windowMinutes = Math.max(1, (Date.now() - since.getTime()) / 60_000);
  let after: MetricSnapshot = computeMetricsFromEvents(
    postEvents,
    windowMinutes,
  );

  if (!enoughDataForOutcome(after) && !opts?.force) {
    const { short } = await updateRollingMetrics(incident.storeId);
    after = short;
  }

  const ready =
    opts?.force ||
    windowExpired ||
    (enoughDataForOutcome(after) &&
      elapsed >= Math.min(5_000, env.OUTCOME_WINDOW_MS));

  if (!ready) {
    return {
      incidentId,
      status: "waiting",
      reason: `elapsed=${elapsed}ms data=${enoughDataForOutcome(after)}`,
    };
  }

  const evaluation = evaluateOutcome(before, after);
  await saveOutcome({
    incidentId,
    before: {
      ...before,
      source: "incident_baseline_metrics_15m",
    },
    after: {
      ...after,
      source: "post_action_events",
      executedAt: action.executedAt.toISOString(),
      improvements: evaluation.improvements,
      regressions: evaluation.regressions,
      score: evaluation.score,
    },
    verdict: evaluation.verdict,
  });

  await updateIncidentStatus(incidentId, evaluation.verdict);

  console.log(
    `[outcome] incident=${incidentId} → ${evaluation.verdict} ` +
      `(improvements=${evaluation.improvements.length}, regressions=${evaluation.regressions.length})`,
  );

  return {
    incidentId,
    status: evaluation.verdict,
    reason:
      evaluation.improvements.join("; ") ||
      evaluation.regressions.join("; "),
  };
}

/**
 * Worker loop: poll VERIFYING incidents and finalize outcomes.
 */
export async function outcomeLoop(signal?: {
  stopped: boolean;
}): Promise<void> {
  console.log(
    `[outcome] loop started (interval=${env.OUTCOME_POLL_INTERVAL_MS}ms, window=${env.OUTCOME_WINDOW_MS}ms)`,
  );

  while (!signal?.stopped) {
    try {
      const verifying = await listVerifyingIncidents();
      for (const incident of verifying) {
        try {
          await evaluateVerifyingIncident(incident.id);
        } catch (err) {
          console.error(`[outcome] evaluate failed for ${incident.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[outcome] tick failed:", err);
    }
    await sleep(env.OUTCOME_POLL_INTERVAL_MS);
  }
}
