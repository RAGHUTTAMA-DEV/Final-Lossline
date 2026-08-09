import { z } from "zod";
import { pool } from "../db/pool.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  type: z.string().optional().default("operational_overload"),
});

export async function getIncidentHistory(raw: unknown) {
  const input = inputSchema.parse(raw);

  const result = await pool.query<{
    id: string;
    status: string;
    baseline: Record<string, unknown> | null;
    created_at: Date;
    action_type: string | null;
    explanation: string | null;
    confidence: number | null;
  }>(
    `SELECT i.id, i.status, i.baseline, i.created_at,
            r.action_type, r.explanation, r.confidence
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT action_type, explanation, confidence
       FROM recommendations
       WHERE incident_id = i.id
       ORDER BY created_at DESC
       LIMIT 1
     ) r ON TRUE
     WHERE i.store_id = $1 AND i.type = $2
     ORDER BY i.created_at DESC
     LIMIT 10`,
    [input.storeId, input.type],
  );

  return {
    storeId: input.storeId,
    type: input.type,
    count: result.rows.length,
    incidents: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      reasons: (row.baseline as { reasons?: string[] } | null)?.reasons ?? [],
      recommendation: row.action_type
        ? {
            actionType: row.action_type,
            explanation: row.explanation,
            confidence: row.confidence,
          }
        : null,
    })),
  };
}
