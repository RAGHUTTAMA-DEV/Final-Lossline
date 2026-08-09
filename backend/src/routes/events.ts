import { Router } from "express";
import {
  ingestEventsBodySchema,
  insertEvent,
  insertEvents,
  type IngestEventInput,
} from "../services/events.js";

export const eventsRouter = Router();

eventsRouter.post("/api/events", async (req, res) => {
  const parsed = ingestEventsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  try {
    if ("events" in parsed.data) {
      const events = await insertEvents(parsed.data.events as IngestEventInput[]);
      res.status(201).json({
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          storeId: e.storeId,
          type: e.type,
          occurredAt: e.occurredAt,
          ingestedAt: e.ingestedAt,
        })),
      });
      return;
    }

    const event = await insertEvent(parsed.data);
    res.status(201).json({
      id: event.id,
      storeId: event.storeId,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
      ingestedAt: event.ingestedAt,
    });
  } catch (err) {
    console.error("[events] ingest failed:", err);
    res.status(500).json({ error: "Failed to ingest event" });
  }
});
