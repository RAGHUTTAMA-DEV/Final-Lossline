import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  SCENARIO_CATALOG,
  buildMeghanaScenario,
  type ScenarioId,
} from "../scenarios/meghana.js";
import {
  detectForStore,
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../services/detection.js";
import { insertEvents } from "../services/events.js";
import { deriveKitchenState } from "../services/kitchenState.js";
import { getEventsSince } from "../services/events.js";

export const scenariosRouter = Router();

const runSchema = z.object({
  id: z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]),
  wipe: z.boolean().optional().default(true),
  detect: z.boolean().optional().default(true),
});

scenariosRouter.get("/api/scenarios", (_req, res) => {
  res.json({
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    storeId: env.STORE_ID,
    scenarios: SCENARIO_CATALOG,
  });
});

scenariosRouter.get("/api/scenarios/kitchen", async (req, res) => {
  try {
    const storeId =
      typeof req.query.storeId === "string" && req.query.storeId.length > 0
        ? req.query.storeId
        : env.STORE_ID;
    const since = new Date(Date.now() - 60 * 60_000);
    const events = await getEventsSince(storeId, since);
    const kitchen = deriveKitchenState(events);
    res.json({ storeId, kitchen, eventCount: events.length });
  } catch (err) {
    console.error("[scenarios/kitchen] failed:", err);
    res.status(500).json({ error: "Failed to load kitchen state" });
  }
});

scenariosRouter.post("/api/scenarios/run", async (req, res) => {
  try {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid scenario run payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { id, wipe, detect } = parsed.data;
    const storeId = env.STORE_ID;
    const built = buildMeghanaScenario(id as ScenarioId, storeId);

    let wiped = { eventsDeleted: 0, metricsDeleted: 0 };
    let resolved: string[] = [];

    if (wipe) {
      resolved = (await resolveOpenIncidents(storeId)).map((i) => i.id);
      wiped = await wipeStoreDemoData(storeId);
    }

    const inserted = await insertEvents(built.events);
    const kitchen = deriveKitchenState(inserted);

    let incident = null;
    if (detect) {
      incident = await detectForStore(storeId);
      // Attach Meghana scenario context onto baseline for UI / agent
      if (incident) {
        const { pool } = await import("../db/pool.js");
        const baseline = {
          ...(incident.baseline ?? {}),
          scenarioId: built.meta.id,
          brand: "Meghana Biryani",
          outlet: built.meta.outlet,
          proves: built.meta.proves,
          expectedRootCause: built.meta.expectedRootCause,
          kitchenInference: kitchen.inferredRootCause,
          story: built.meta.story,
        };
        await pool.query(
          `UPDATE incidents SET baseline = $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [incident.id, JSON.stringify(baseline)],
        );
        incident = { ...incident, baseline };
      }
    }

    res.json({
      ok: true,
      scenario: built.meta,
      storeId,
      eventsIngested: inserted.length,
      wiped,
      resolvedOpen: resolved.length,
      kitchen,
      incident: incident
        ? {
            id: incident.id,
            status: incident.status,
            baseline: incident.baseline,
          }
        : null,
      verdict: built.meta.expectIncident
        ? incident
          ? "DETECTED_as_expected"
          : "expected_incident_but_thresholds_not_met"
        : incident
          ? "FALSE_POSITIVE_unexpected"
          : "QUIET_as_expected",
    });
  } catch (err) {
    console.error("[scenarios/run] failed:", err);
    res.status(500).json({ error: "Failed to run scenario" });
  }
});
