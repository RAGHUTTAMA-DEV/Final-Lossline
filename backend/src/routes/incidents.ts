import { Router } from "express";
import { runInvestigationAgent } from "../loops/investigation.js";
import { evaluateVerifyingIncident } from "../loops/outcome.js";
import { getLatestAction } from "../services/actions.js";
import { approveIncident, rejectIncident } from "../services/approval.js";
import { listAgentRuns } from "../services/agentRuns.js";
import { getIncidentById, listIncidents } from "../services/detection.js";
import { getLatestOutcome } from "../services/outcomes.js";
import { getLatestRecommendation } from "../services/recommendations.js";

export const incidentsRouter = Router();

function statusCodeFromErr(err: unknown): number {
  if (
    err &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  if (err instanceof Error && err.message.includes("not found")) return 404;
  return 500;
}

incidentsRouter.get("/api/incidents", async (req, res) => {
  const limitRaw = req.query.limit;
  const limit = Math.min(
    Math.max(Number(limitRaw ?? 50) || 50, 1),
    200,
  );

  try {
    const incidents = await listIncidents(limit);
    res.json({
      incidents: incidents.map((i) => ({
        id: i.id,
        storeId: i.storeId,
        type: i.type,
        status: i.status,
        baseline: i.baseline,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[incidents] list failed:", err);
    res.status(500).json({ error: "Failed to list incidents" });
  }
});

incidentsRouter.get("/api/incidents/:id", async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    const [agentRuns, recommendation, action, outcome] = await Promise.all([
      listAgentRuns(incident.id),
      getLatestRecommendation(incident.id),
      getLatestAction(incident.id),
      getLatestOutcome(incident.id),
    ]);

    res.json({
      id: incident.id,
      storeId: incident.storeId,
      type: incident.type,
      status: incident.status,
      baseline: incident.baseline,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      agentRuns: agentRuns.map((r) => ({
        id: r.id,
        step: r.step,
        messages: r.messages,
        createdAt: r.createdAt,
      })),
      recommendation: recommendation
        ? {
            id: recommendation.id,
            confidence: recommendation.confidence,
            explanation: recommendation.explanation,
            actionType: recommendation.actionType,
            estimatedExposure: recommendation.estimatedExposure,
            createdAt: recommendation.createdAt,
          }
        : null,
      action: action
        ? {
            id: action.id,
            recommendationId: action.recommendationId,
            approvedBy: action.approvedBy,
            approvedAt: action.approvedAt,
            executedAt: action.executedAt,
            params: action.params,
          }
        : null,
      outcome: outcome
        ? {
            id: outcome.id,
            before: outcome.before,
            after: outcome.after,
            verdict: outcome.verdict,
            evaluatedAt: outcome.evaluatedAt,
          }
        : null,
    });
  } catch (err) {
    console.error("[incidents] get failed:", err);
    res.status(500).json({ error: "Failed to get incident" });
  }
});

/** Manually kick investigation (e.g. incident stuck in DETECTED without worker). */
incidentsRouter.post("/api/incidents/:id/investigate", async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    if (
      incident.status !== "DETECTED" &&
      incident.status !== "INVESTIGATING"
    ) {
      res.status(409).json({
        error: `Cannot investigate incident in status ${incident.status}`,
      });
      return;
    }

    const result = await runInvestigationAgent(incident.id);
    res.json(result);
  } catch (err) {
    console.error("[incidents] investigate failed:", err);
    const message = err instanceof Error ? err.message : "Investigation failed";
    res.status(500).json({ error: message });
  }
});

/** Approve recommendation → execute simulated action → VERIFYING. */
incidentsRouter.post("/api/incidents/:id/approve", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      approvedBy?: string;
      params?: Record<string, unknown>;
    };
    const result = await approveIncident(req.params.id, {
      approvedBy: body.approvedBy,
      params: body.params,
    });
    res.json({
      id: result.incident.id,
      status: result.incident.status,
      recommendation: {
        id: result.recommendation.id,
        actionType: result.recommendation.actionType,
        confidence: result.recommendation.confidence,
      },
      action: {
        id: result.action.id,
        approvedBy: result.action.approvedBy,
        approvedAt: result.action.approvedAt,
        executedAt: result.action.executedAt,
        params: result.action.params,
      },
      recoveryEvents: result.recoveryEvents,
    });
  } catch (err) {
    console.error("[incidents] approve failed:", err);
    const code = statusCodeFromErr(err);
    const message = err instanceof Error ? err.message : "Approve failed";
    res.status(code).json({ error: message });
  }
});

/** Reject recommendation → close as NOT_IMPROVED. */
incidentsRouter.post("/api/incidents/:id/reject", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      rejectedBy?: string;
      reason?: string;
    };
    const result = await rejectIncident(req.params.id, {
      rejectedBy: body.rejectedBy,
      reason: body.reason,
    });
    res.json({
      id: result.incident.id,
      status: result.incident.status,
      action: {
        id: result.action.id,
        approvedBy: result.action.approvedBy,
        approvedAt: result.action.approvedAt,
        params: result.action.params,
      },
    });
  } catch (err) {
    console.error("[incidents] reject failed:", err);
    const code = statusCodeFromErr(err);
    const message = err instanceof Error ? err.message : "Reject failed";
    res.status(code).json({ error: message });
  }
});

/** Force outcome evaluation for a VERIFYING incident (debug / smoke). */
incidentsRouter.post("/api/incidents/:id/evaluate-outcome", async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    if (incident.status !== "VERIFYING") {
      res.status(409).json({
        error: `Cannot evaluate outcome in status ${incident.status}`,
      });
      return;
    }

    const result = await evaluateVerifyingIncident(incident.id, { force: true });
    const updated = await getIncidentById(incident.id);
    const outcome = await getLatestOutcome(incident.id);

    res.json({
      tick: result,
      status: updated?.status,
      outcome: outcome
        ? {
            id: outcome.id,
            before: outcome.before,
            after: outcome.after,
            verdict: outcome.verdict,
            evaluatedAt: outcome.evaluatedAt,
          }
        : null,
    });
  } catch (err) {
    console.error("[incidents] evaluate-outcome failed:", err);
    const message =
      err instanceof Error ? err.message : "Outcome evaluation failed";
    res.status(500).json({ error: message });
  }
});
