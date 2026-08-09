import { pool } from "../db/pool.js";
import type { ActionRecord } from "../types/index.js";

interface ActionRow {
  id: string;
  incident_id: string;
  recommendation_id: string;
  approved_by: string | null;
  approved_at: Date | null;
  executed_at: Date | null;
  params: Record<string, unknown> | null;
}

function mapAction(row: ActionRow): ActionRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    recommendationId: row.recommendation_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    params: row.params,
  };
}

export async function createAction(input: {
  incidentId: string;
  recommendationId: string;
  approvedBy?: string | null;
  params?: Record<string, unknown> | null;
}): Promise<ActionRecord> {
  const result = await pool.query<ActionRow>(
    `INSERT INTO actions
       (incident_id, recommendation_id, approved_by, approved_at, params)
     VALUES ($1, $2, $3, NOW(), $4::jsonb)
     RETURNING id, incident_id, recommendation_id, approved_by, approved_at,
               executed_at, params`,
    [
      input.incidentId,
      input.recommendationId,
      input.approvedBy ?? null,
      JSON.stringify(input.params ?? {}),
    ],
  );
  return mapAction(result.rows[0]);
}

export async function createRejectionAction(input: {
  incidentId: string;
  recommendationId: string;
  rejectedBy?: string | null;
  reason?: string | null;
}): Promise<ActionRecord> {
  const result = await pool.query<ActionRow>(
    `INSERT INTO actions
       (incident_id, recommendation_id, approved_by, approved_at, params)
     VALUES ($1, $2, $3, NULL, $4::jsonb)
     RETURNING id, incident_id, recommendation_id, approved_by, approved_at,
               executed_at, params`,
    [
      input.incidentId,
      input.recommendationId,
      input.rejectedBy ?? null,
      JSON.stringify({
        rejected: true,
        reason: input.reason ?? "rejected_by_operator",
      }),
    ],
  );
  return mapAction(result.rows[0]);
}

export async function markActionExecuted(
  actionId: string,
  params?: Record<string, unknown>,
  executedAt?: Date,
): Promise<ActionRecord | null> {
  const result = await pool.query<ActionRow>(
    `UPDATE actions
     SET executed_at = COALESCE($3, NOW()),
         params = CASE
           WHEN $2::jsonb IS NULL THEN params
           ELSE COALESCE(params, '{}'::jsonb) || $2::jsonb
         END
     WHERE id = $1
     RETURNING id, incident_id, recommendation_id, approved_by, approved_at,
               executed_at, params`,
    [
      actionId,
      params ? JSON.stringify(params) : null,
      executedAt ?? null,
    ],
  );
  const row = result.rows[0];
  return row ? mapAction(row) : null;
}

export async function getLatestAction(
  incidentId: string,
): Promise<ActionRecord | null> {
  const result = await pool.query<ActionRow>(
    `SELECT id, incident_id, recommendation_id, approved_by, approved_at,
            executed_at, params
     FROM actions
     WHERE incident_id = $1
     ORDER BY COALESCE(approved_at, executed_at, NOW()) DESC, id DESC
     LIMIT 1`,
    [incidentId],
  );
  const row = result.rows[0];
  return row ? mapAction(row) : null;
}
