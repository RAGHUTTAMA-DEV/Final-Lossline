import { pool } from "../db/pool.js";
import type { Recommendation } from "../types/index.js";

export interface SaveRecommendationInput {
  incidentId: string;
  confidence: number;
  explanation: string;
  actionType: string;
  estimatedExposure: number | null;
}

export async function saveRecommendation(
  input: SaveRecommendationInput,
): Promise<Recommendation> {
  const result = await pool.query<{
    id: string;
    incident_id: string;
    confidence: number;
    explanation: string;
    action_type: string;
    estimated_exposure: string | null;
    created_at: Date;
  }>(
    `INSERT INTO recommendations
       (incident_id, confidence, explanation, action_type, estimated_exposure)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, incident_id, confidence, explanation, action_type,
               estimated_exposure, created_at`,
    [
      input.incidentId,
      input.confidence,
      input.explanation,
      input.actionType,
      input.estimatedExposure,
    ],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    incidentId: row.incident_id,
    confidence: row.confidence,
    explanation: row.explanation,
    actionType: row.action_type,
    estimatedExposure:
      row.estimated_exposure !== null ? Number(row.estimated_exposure) : null,
    createdAt: row.created_at,
  };
}

export async function getLatestRecommendation(
  incidentId: string,
): Promise<Recommendation | null> {
  const result = await pool.query<{
    id: string;
    incident_id: string;
    confidence: number;
    explanation: string;
    action_type: string;
    estimated_exposure: string | null;
    created_at: Date;
  }>(
    `SELECT id, incident_id, confidence, explanation, action_type,
            estimated_exposure, created_at
     FROM recommendations
     WHERE incident_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [incidentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    incidentId: row.incident_id,
    confidence: row.confidence,
    explanation: row.explanation,
    actionType: row.action_type,
    estimatedExposure:
      row.estimated_exposure !== null ? Number(row.estimated_exposure) : null,
    createdAt: row.created_at,
  };
}

const VALID_ACTIONS = new Set([
  "pause_delivery",
  "call_in_prep_staff",
  "extend_prep_eta",
  "throttle_new_orders",
]);

export interface ParsedRecommendation {
  action_type: string;
  explanation: string;
  estimated_exposure: number | null;
  severity?: string;
}

/** Extract JSON recommendation block from model final text. */
export function parseRecommendationText(text: string): ParsedRecommendation | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1],
    text.match(/\{[\s\S]*"action_type"[\s\S]*\}/)?.[0],
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const actionType = String(parsed.action_type ?? parsed.actionType ?? "");
      const explanation = String(parsed.explanation ?? "").trim();
      if (!actionType || !explanation) continue;

      let estimated: number | null = null;
      const exp = parsed.estimated_exposure ?? parsed.estimatedExposure;
      if (typeof exp === "number" && Number.isFinite(exp)) estimated = exp;
      else if (typeof exp === "string" && exp.trim() !== "" && !Number.isNaN(Number(exp))) {
        estimated = Number(exp);
      }

      return {
        action_type: VALID_ACTIONS.has(actionType)
          ? actionType
          : "pause_delivery",
        explanation,
        estimated_exposure: estimated,
        severity:
          typeof parsed.severity === "string" ? parsed.severity : undefined,
      };
    } catch {
      // try next candidate
    }
  }

  return null;
}
