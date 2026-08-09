import { env } from "../config/env.js";
import { claimNextDetectedIncident } from "../services/detection.js";
import { sleep } from "../utils/sleep.js";
import { runInvestigationAgent } from "./investigation.js";

/**
 * Poll for DETECTED incidents and run the Gemini investigation agent.
 * Runs alongside the detection loop in the worker process.
 */
export async function investigationLoop(signal?: {
  stopped: boolean;
}): Promise<void> {
  console.log("[investigation] loop started");

  while (!signal?.stopped) {
    try {
      const incident = await claimNextDetectedIncident();
      if (incident) {
        console.log(`[investigation] claimed ${incident.id}`);
        try {
          await runInvestigationAgent(incident.id);
        } catch (err) {
          console.error(`[investigation] agent failed for ${incident.id}:`, err);
        }
      } else {
        await sleep(Math.min(env.DETECTION_INTERVAL_MS, 3000));
      }
    } catch (err) {
      console.error("[investigation] tick failed:", err);
      await sleep(3000);
    }
  }
}
