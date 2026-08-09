import {
  createAction,
  createRejectionAction,
} from "./actions.js";
import {
  getIncidentById,
  listIncidents,
  updateIncidentStatus,
} from "./detection.js";
import { executeAction } from "./executeAction.js";
import { getLatestRecommendation } from "./recommendations.js";
import type { ActionRecord, Incident, Recommendation } from "../types/index.js";

export interface ApproveResult {
  incident: Incident;
  recommendation: Recommendation;
  action: ActionRecord;
  recoveryEvents: number;
}

export interface RejectResult {
  incident: Incident;
  action: ActionRecord;
}

/**
 * Human approves recommendation → create action → simulate execute → VERIFYING.
 */
export async function approveIncident(
  incidentId: string,
  opts?: { approvedBy?: string; params?: Record<string, unknown> },
): Promise<ApproveResult> {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    throw new Error(`Incident not found: ${incidentId}`);
  }
  if (incident.status !== "AWAITING_APPROVAL") {
    throw Object.assign(
      new Error(`Cannot approve incident in status ${incident.status}`),
      { statusCode: 409 },
    );
  }

  const recommendation = await getLatestRecommendation(incidentId);
  if (!recommendation) {
    throw Object.assign(new Error("No recommendation to approve"), {
      statusCode: 409,
    });
  }

  await updateIncidentStatus(incidentId, "APPROVED");

  const action = await createAction({
    incidentId,
    recommendationId: recommendation.id,
    approvedBy: opts?.approvedBy ?? "operator",
    params: {
      action_type: recommendation.actionType,
      ...(opts?.params ?? {}),
    },
  });

  await updateIncidentStatus(incidentId, "EXECUTING");

  const executed = await executeAction({
    storeId: incident.storeId,
    action,
    recommendation,
  });

  const verifying = await updateIncidentStatus(incidentId, "VERIFYING");
  if (!verifying) {
    throw new Error(`Failed to set VERIFYING on ${incidentId}`);
  }

  console.log(
    `[approval] incident=${incidentId} approved → VERIFYING ` +
      `(action=${executed.action.id}, type=${recommendation.actionType})`,
  );

  return {
    incident: verifying,
    recommendation,
    action: executed.action,
    recoveryEvents: executed.recoveryEvents,
  };
}

/**
 * Human rejects recommendation → log rejection action → close as NOT_IMPROVED.
 */
export async function rejectIncident(
  incidentId: string,
  opts?: { rejectedBy?: string; reason?: string },
): Promise<RejectResult> {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    throw new Error(`Incident not found: ${incidentId}`);
  }
  if (incident.status !== "AWAITING_APPROVAL") {
    throw Object.assign(
      new Error(`Cannot reject incident in status ${incident.status}`),
      { statusCode: 409 },
    );
  }

  const recommendation = await getLatestRecommendation(incidentId);
  if (!recommendation) {
    throw Object.assign(new Error("No recommendation to reject"), {
      statusCode: 409,
    });
  }

  const action = await createRejectionAction({
    incidentId,
    recommendationId: recommendation.id,
    rejectedBy: opts?.rejectedBy ?? "operator",
    reason: opts?.reason ?? "rejected_by_operator",
  });

  const closed = await updateIncidentStatus(incidentId, "NOT_IMPROVED");
  if (!closed) {
    throw new Error(`Failed to close rejected incident ${incidentId}`);
  }

  console.log(
    `[approval] incident=${incidentId} rejected → NOT_IMPROVED ` +
      `(reason=${opts?.reason ?? "rejected_by_operator"})`,
  );

  return { incident: closed, action };
}

/** Incidents waiting on outcome verification. */
export async function listVerifyingIncidents(): Promise<Incident[]> {
  const all = await listIncidents(100);
  return all.filter((i) => i.status === "VERIFYING");
}
