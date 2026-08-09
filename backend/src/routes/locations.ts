import { Router } from "express";
import { z } from "zod";
import { primaryStoreId, getPortfolioStore } from "../portfolio/stores.js";
import {
  compareLocations,
  getLocationAnalytics,
  listLocationHeadlines,
} from "../services/locationAnalytics.js";
import { seedPortfolio } from "../services/seedPortfolio.js";

export const locationsRouter = Router();

locationsRouter.get("/api/locations", async (_req, res) => {
  try {
    const locations = await listLocationHeadlines();
    res.json({
      locations,
      seededCount: locations.filter((l) => l.seeded).length,
      mapCenter: { lat: 12.97, lng: 77.64 },
    });
  } catch (err) {
    console.error("[locations] list failed:", err);
    res.status(500).json({ error: "Failed to list locations" });
  }
});

locationsRouter.get("/api/locations/compare", async (req, res) => {
  try {
    const a =
      typeof req.query.a === "string" && req.query.a.length > 0
        ? req.query.a
        : "meghana_jayanagar";
    const b =
      typeof req.query.b === "string" && req.query.b.length > 0
        ? req.query.b
        : primaryStoreId();

    if (!getPortfolioStore(a) || !getPortfolioStore(b)) {
      res.status(404).json({ error: "Unknown store id(s) for compare" });
      return;
    }

    const withNarrative = !(
      req.query.narrative === "0" || req.query.narrative === "false"
    );

    const result = await compareLocations(a, b, withNarrative);
    if (!result) {
      res.status(404).json({ error: "Unknown store id(s) for compare" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("[locations] compare failed:", err);
    res.status(500).json({ error: "Failed to compare locations" });
  }
});

const seedSchema = z.object({
  keepPrimary: z.boolean().optional().default(false),
  days: z.number().int().min(1).max(14).optional().default(7),
});

locationsRouter.post("/api/locations/seed", async (req, res) => {
  try {
    const parsed = seedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid seed payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await seedPortfolio({
      keepPrimary: parsed.data.keepPrimary,
      days: parsed.data.days,
    });

    res.json({
      ok: true,
      message: parsed.data.keepPrimary
        ? "Seeded Jayanagar + Indiranagar (Koramangala kept)."
        : "Seeded Koramangala + Jayanagar + Indiranagar (7-day history).",
      ...result,
    });
  } catch (err) {
    console.error("[locations] seed failed:", err);
    res.status(500).json({ error: "Failed to seed portfolio" });
  }
});

locationsRouter.get("/api/locations/:storeId", async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 30);
    const analytics = await getLocationAnalytics(storeId, days);
    if (!analytics) {
      res.status(404).json({ error: "Unknown location" });
      return;
    }
    res.json(analytics);
  } catch (err) {
    console.error("[locations] detail failed:", err);
    res.status(500).json({ error: "Failed to load location analytics" });
  }
});
