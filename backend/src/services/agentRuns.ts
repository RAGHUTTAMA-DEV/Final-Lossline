import { pool } from "../db/pool.js";
import type { AgentRun } from "../types/index.js";

export async function insertAgentRun(
  incidentId: string,
  step: number,
  messages: unknown,
): Promise<AgentRun> {
  const result = await pool.query<{
    id: string;
    incident_id: string;
    step: number;
    messages: unknown;
    created_at: Date;
  }>(
    `INSERT INTO agent_runs (incident_id, step, messages)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, incident_id, step, messages, created_at`,
    [incidentId, step, JSON.stringify(messages)],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    incidentId: row.incident_id,
    step: row.step,
    messages: row.messages,
    createdAt: row.created_at,
  };
}

export async function listAgentRuns(incidentId: string): Promise<AgentRun[]> {
  const result = await pool.query<{
    id: string;
    incident_id: string;
    step: number;
    messages: unknown;
    created_at: Date;
  }>(
    `SELECT id, incident_id, step, messages, created_at
     FROM agent_runs
     WHERE incident_id = $1
     ORDER BY step ASC`,
    [incidentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    incidentId: row.incident_id,
    step: row.step,
    messages: row.messages,
    createdAt: row.created_at,
  }));
}
