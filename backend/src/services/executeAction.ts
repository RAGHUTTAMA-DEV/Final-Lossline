import { getRecommendationOptions } from "../tools/getRecommendationOptions.js";
import type { ActionRecord, Recommendation } from "../types/index.js";
import { markActionExecuted } from "./actions.js";
import { insertEvents, type IngestEventInput } from "./events.js";
import { updateRollingMetrics } from "./metrics.js";

/**
 * Resolve canned params for an action_type from recommendation options.
 */
export async function resolveActionParams(
  actionType: string,
  overrides?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const { options } = await getRecommendationOptions({
    incidentType: "operational_overload",
    signals: [],
  });
  const match = options.find((o) => o.action_type === actionType);
  return {
    action_type: actionType,
    ...(match?.params ?? {}),
    ...(overrides ?? {}),
    simulated: true,
  };
}

/**
 * Simulated execute_action: stamp executed_at and inject recovering
 * events so the outcome poller can observe metric improvement in demo.
 *
 * Recovery event timestamps are placed *after* executed_at so
 * getEventsSince(executedAt) picks them up.
 */
export async function executeAction(input: {
  storeId: string;
  action: ActionRecord;
  recommendation: Recommendation;
}): Promise<{
  action: ActionRecord;
  recoveryEvents: number;
  params: Record<string, unknown>;
}> {
  const params = await resolveActionParams(
    input.recommendation.actionType,
    input.action.params,
  );

  const executedAt = new Date();
  const recovery = buildRecoveryEvents(
    input.storeId,
    input.recommendation.actionType,
    executedAt,
  );

  // Mark executed slightly before recovery timestamps
  const updated = await markActionExecuted(
    input.action.id,
    {
      ...params,
      recoveryEventsInjected: recovery.length,
      executedNote: `Simulated ${input.recommendation.actionType}`,
    },
    new Date(executedAt.getTime() - 1000),
  );

  if (!updated) {
    throw new Error(`Failed to mark action executed: ${input.action.id}`);
  }

  if (recovery.length > 0) {
    await insertEvents(recovery);
    await updateRollingMetrics(input.storeId);
  }

  console.log(
    `[execute] action=${updated.id} type=${input.recommendation.actionType} ` +
      `recoveryEvents=${recovery.length}`,
  );

  return {
    action: updated,
    recoveryEvents: recovery.length,
    params,
  };
}

/**
 * Inject healthier events after action time so post-action metrics cool off.
 */
function buildRecoveryEvents(
  storeId: string,
  actionType: string,
  executedAt: Date,
): IngestEventInput[] {
  const events: IngestEventInput[] = [];
  const tag = `recovery_${executedAt.getTime()}`;
  const base = executedAt.getTime();

  const orderCount =
    actionType === "pause_delivery" || actionType === "throttle_new_orders"
      ? 2
      : 3;

  for (let i = 0; i < orderCount; i += 1) {
    events.push({
      storeId,
      type: "order",
      payload: {
        orderId: `${tag}_ord_${i}`,
        amount: 320,
        source: "post_action_recovery",
      },
      occurredAt: new Date(base + (i + 1) * 1000).toISOString(),
    });
  }

  for (let i = 0; i < 3; i += 1) {
    events.push({
      storeId,
      type: "prep_complete",
      payload: {
        orderId: `${tag}_ord_${i}`,
        prepMinutes: 10 + i,
        source: "post_action_recovery",
      },
      occurredAt: new Date(base + (i + 1) * 1000 + 200).toISOString(),
    });
    events.push({
      storeId,
      type: "handoff",
      payload: {
        orderId: `${tag}_ord_${i}`,
        delayMinutes: 2 + i * 0.5,
        source: "post_action_recovery",
      },
      occurredAt: new Date(base + (i + 1) * 1000 + 400).toISOString(),
    });
  }

  return events;
}
