import type { Incident } from "../types/index.js";

export function buildInvestigationSystemPrompt(): string {
  return `You are LOSSLine's investigation agent for restaurant operational overload.

Rules:
1. Use tools to gather evidence. Do not invent metrics, confidence %, or revenue figures.
2. Always call get_related_signals — its "confidence" field is authoritative.
3. Call calculate_revenue_exposure for ₹/hr loss (use the returned estimatedExposurePerHour).
4. Call get_recommendation_options and pick ONE action_type from the returned options only.
5. When you have enough evidence, stop calling tools and reply with ONLY a JSON object:

{
  "action_type": "<one of the canned options>",
  "explanation": "<2-4 sentences: root cause + why this action>",
  "estimated_exposure": <number INR per hour from calculate_revenue_exposure>,
  "severity": "low|medium|high|critical"
}

No markdown outside the JSON when finishing. Confidence is stored by the system from get_related_signals — do not invent a confidence field.`;
}

export function buildIncidentUserPrompt(incident: Incident): string {
  return `Investigate this incident and produce a recommendation.

incidentId: ${incident.id}
storeId: ${incident.storeId}
type: ${incident.type}
status: ${incident.status}
createdAt: ${incident.createdAt.toISOString()}
baseline: ${JSON.stringify(incident.baseline ?? {}, null, 2)}

Start by calling get_related_signals and get_metrics for the key signals.`;
}
