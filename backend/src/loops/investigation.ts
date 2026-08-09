import { env } from "../config/env.js";
import { createLLMClient, type ChatMessage } from "../llm/index.js";
import {
  buildIncidentUserPrompt,
  buildInvestigationSystemPrompt,
} from "../prompts/investigation.js";
import { insertAgentRun } from "../services/agentRuns.js";
import {
  getIncidentById,
  updateIncidentStatus,
} from "../services/detection.js";
import {
  parseRecommendationText,
  saveRecommendation,
} from "../services/recommendations.js";
import { investigationTools } from "../tools/definitions.js";
import { executeTool } from "../tools/execute.js";

export interface InvestigationResult {
  incidentId: string;
  status: "AWAITING_APPROVAL" | "MANUAL_REVIEW";
  recommendationId?: string;
  confidence?: number;
  steps: number;
}

function extractConfidenceFromToolResult(name: string, result: unknown): number | null {
  if (name !== "get_related_signals") return null;
  if (!result || typeof result !== "object") return null;
  const confidence = (result as { confidence?: unknown }).confidence;
  return typeof confidence === "number" ? confidence : null;
}

function extractExposureFromToolResult(name: string, result: unknown): number | null {
  if (name !== "calculate_revenue_exposure") return null;
  if (!result || typeof result !== "object") return null;
  const v = (result as { estimatedExposurePerHour?: unknown }).estimatedExposurePerHour;
  return typeof v === "number" ? v : null;
}

export async function runInvestigationAgent(
  incidentId: string,
): Promise<InvestigationResult> {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  if (incident.status === "DETECTED") {
    await updateIncidentStatus(incidentId, "INVESTIGATING");
  }

  const llm = createLLMClient();
  const system = buildInvestigationSystemPrompt();
  const messages: ChatMessage[] = [
    { role: "user", content: buildIncidentUserPrompt(incident) },
  ];

  let lastConfidence = 0;
  let lastExposure: number | null = null;

  for (let step = 0; step < env.AGENT_MAX_STEPS; step += 1) {
    console.log(`[agent] incident=${incidentId} step=${step}`);

    const response = await llm.chat({
      system,
      messages,
      tools: investigationTools,
    });

    const modelTurn: ChatMessage = {
      role: "model",
      content: response.text ?? "",
      toolCalls: response.toolCalls,
    };

    await insertAgentRun(incidentId, step, {
      messages: [...messages, modelTurn],
      toolCalls: response.toolCalls,
      text: response.text ?? null,
    });

    if (response.toolCalls.length === 0) {
      const text = response.text ?? "";
      const parsed = parseRecommendationText(text);

      const explanation =
        parsed?.explanation ??
        (text.trim().slice(0, 2000) ||
          "Investigation completed without structured recommendation.");
      const actionType = parsed?.action_type ?? "pause_delivery";
      const exposure = parsed?.estimated_exposure ?? lastExposure;

      const recommendation = await saveRecommendation({
        incidentId,
        confidence: lastConfidence,
        explanation,
        actionType,
        estimatedExposure: exposure,
      });

      await updateIncidentStatus(incidentId, "AWAITING_APPROVAL");
      console.log(
        `[agent] incident=${incidentId} → AWAITING_APPROVAL confidence=${lastConfidence}% action=${actionType}`,
      );

      return {
        incidentId,
        status: "AWAITING_APPROVAL",
        recommendationId: recommendation.id,
        confidence: lastConfidence,
        steps: step + 1,
      };
    }

    messages.push(modelTurn);

    const toolMessages: ChatMessage[] = [];
    for (const call of response.toolCalls) {
      let result: unknown;
      try {
        result = await executeTool(call.name, call.args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = { error: message };
      }

      const conf = extractConfidenceFromToolResult(call.name, result);
      if (conf !== null) lastConfidence = conf;
      const exp = extractExposureFromToolResult(call.name, result);
      if (exp !== null) lastExposure = exp;

      console.log(`[agent] tool ${call.name} ok`);
      toolMessages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
    }

    messages.push(...toolMessages);
  }

  await flagForManualReview(incidentId, lastConfidence, lastExposure);
  return {
    incidentId,
    status: "MANUAL_REVIEW",
    confidence: lastConfidence,
    steps: env.AGENT_MAX_STEPS,
  };
}

async function flagForManualReview(
  incidentId: string,
  confidence: number,
  exposure: number | null,
): Promise<void> {
  console.warn(`[agent] incident=${incidentId} hit MAX_STEPS — manual review`);
  await saveRecommendation({
    incidentId,
    confidence,
    explanation:
      "Agent reached max steps without a final recommendation. Needs human review of the agent_runs trace.",
    actionType: "pause_delivery",
    estimatedExposure: exposure,
  });
  // Stay investigable but surface as awaiting approval so UI can show the fallback
  await updateIncidentStatus(incidentId, "AWAITING_APPROVAL");
}
