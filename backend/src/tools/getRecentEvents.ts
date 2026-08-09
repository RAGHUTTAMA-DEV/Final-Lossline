import { z } from "zod";
import { getEventsSince } from "../services/events.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  sinceMinutes: z.number().positive().max(180).optional().default(30),
});

export async function getRecentEvents(raw: unknown) {
  const input = inputSchema.parse(raw);
  const since = new Date(Date.now() - input.sinceMinutes * 60_000);
  const events = await getEventsSince(input.storeId, since);

  return {
    storeId: input.storeId,
    sinceMinutes: input.sinceMinutes,
    count: events.length,
    events: events.slice(-100).map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
}
