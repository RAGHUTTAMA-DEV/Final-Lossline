import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copilotRouter } from "./routes/copilot.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { incidentsRouter } from "./routes/incidents.js";
import { summaryRouter } from "./routes/summary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Works for both tsx (src/) and compiled (dist/)
const frontendDir = path.resolve(__dirname, "..", "..", "frontend");

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(eventsRouter);
  app.use(incidentsRouter);
  app.use(summaryRouter);
  app.use(copilotRouter);

  // Simple HTML UI (Phase 4)
  console.log(`[boot] serving frontend from ${frontendDir}`);
  app.use(express.static(frontendDir));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("[express] unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
