import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getRedisAvailable } from "../redis/client.js";
import { addEvent as redisAddEvent } from "../redis/streams.js";
import { EVENT_TYPES, type EventType, type StoreEvent } from "../types/index.js";

export const ingestEventSchema = z.object({
  storeId: z.string().min(1).optional(),
  type: z.enum(EVENT_TYPES),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

export const ingestEventsBodySchema = z.union([
  ingestEventSchema,
  z.object({
    events: z.array(ingestEventSchema).min(1).max(500),
  }),
]);

export type IngestEventInput = z.infer<typeof ingestEventSchema>;

interface EventRow {
  id: string;
  store_id: string;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  ingested_at: Date;
}

function mapRow(row: EventRow): StoreEvent {
  return {
    id: row.id,
    storeId: row.store_id,
    type: row.type as EventType,
    payload: row.payload ?? {},
    occurredAt: row.occurred_at,
    ingestedAt: row.ingested_at,
  };
}

export async function insertEvent(input: IngestEventInput): Promise<StoreEvent> {
  const storeId = input.storeId ?? env.STORE_ID;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

  const result = await pool.query<EventRow>(
    `INSERT INTO events (store_id, type, payload, occurred_at)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, store_id, type, payload, occurred_at, ingested_at`,
    [storeId, input.type, JSON.stringify(input.payload), occurredAt],
  );

  const event = mapRow(result.rows[0]);

  if (getRedisAvailable()) {
    try {
      await redisAddEvent({
        eventId: event.id,
        storeId: event.storeId,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[events] Redis XADD failed (event still in Postgres): ${message}`);
    }
  }

  return event;
}

export async function insertEvents(inputs: IngestEventInput[]): Promise<StoreEvent[]> {
  const out: StoreEvent[] = [];
  for (const input of inputs) {
    out.push(await insertEvent(input));
  }
  return out;
}

export async function getEventsSince(
  storeId: string,
  since: Date,
): Promise<StoreEvent[]> {
  const result = await pool.query<EventRow>(
    `SELECT id, store_id, type, payload, occurred_at, ingested_at
     FROM events
     WHERE store_id = $1 AND occurred_at >= $2
     ORDER BY occurred_at ASC`,
    [storeId, since],
  );
  return result.rows.map(mapRow);
}

export async function getEventsAfterId(
  lastSeenId: string | null,
  limit = 200,
): Promise<StoreEvent[]> {
  if (!lastSeenId) {
    const result = await pool.query<EventRow>(
      `SELECT id, store_id, type, payload, occurred_at, ingested_at
       FROM events
       ORDER BY ingested_at ASC, id ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapRow);
  }

  const result = await pool.query<EventRow>(
    `SELECT id, store_id, type, payload, occurred_at, ingested_at
     FROM events
     WHERE ingested_at > (SELECT ingested_at FROM events WHERE id = $1::uuid)
        OR (
          ingested_at = (SELECT ingested_at FROM events WHERE id = $1::uuid)
          AND id > $1::uuid
        )
     ORDER BY ingested_at ASC, id ASC
     LIMIT $2`,
    [lastSeenId, limit],
  );
  return result.rows.map(mapRow);
}

export async function listActiveStoreIds(withinMinutes = 120): Promise<string[]> {
  const result = await pool.query<{ store_id: string }>(
    `SELECT DISTINCT store_id
     FROM events
     WHERE occurred_at >= NOW() - ($1 * INTERVAL '1 minute')`,
    [withinMinutes],
  );
  const ids = result.rows.map((r) => r.store_id);
  if (!ids.includes(env.STORE_ID)) {
    ids.push(env.STORE_ID);
  }
  return ids;
}

export interface DailyActivityPoint {
  date: string;
  orders: number;
  cancellations: number;
  prepCompletes: number;
  handoffs: number;
  revenueEstimate: number;
}

function ymd(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** Day-bucketed event counts for dashboard charts (last N days). */
export async function getDailyActivity(
  storeId: string,
  days = 7,
): Promise<DailyActivityPoint[]> {
  const safeDays = Math.min(Math.max(days, 1), 30);
  const result = await pool.query<{
    day: Date;
    orders: string;
    cancellations: string;
    prep_completes: string;
    handoffs: string;
    revenue_estimate: string;
  }>(
    `WITH days AS (
       SELECT generate_series(
         (CURRENT_DATE - ($2::int - 1)),
         CURRENT_DATE,
         INTERVAL '1 day'
       )::date AS day
     )
     SELECT
       d.day,
       COUNT(e.id) FILTER (WHERE e.type = 'order')::int AS orders,
       COUNT(e.id) FILTER (WHERE e.type = 'cancellation')::int AS cancellations,
       COUNT(e.id) FILTER (WHERE e.type = 'prep_complete')::int AS prep_completes,
       COUNT(e.id) FILTER (WHERE e.type = 'handoff')::int AS handoffs,
       COALESCE(
         SUM(
           CASE
             WHEN e.type = 'order' THEN COALESCE((e.payload->>'amount')::numeric, 0)
             ELSE 0
           END
         ),
         0
       ) AS revenue_estimate
     FROM days d
     LEFT JOIN events e
       ON e.store_id = $1
      AND e.occurred_at::date = d.day
     GROUP BY d.day
     ORDER BY d.day ASC`,
    [storeId, safeDays],
  );

  return result.rows.map((r) => ({
    date: ymd(r.day),
    orders: Number(r.orders) || 0,
    cancellations: Number(r.cancellations) || 0,
    prepCompletes: Number(r.prep_completes) || 0,
    handoffs: Number(r.handoffs) || 0,
    revenueEstimate: Number(r.revenue_estimate) || 0,
  }));
}
