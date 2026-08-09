/**
 * Close open incidents (and optionally wipe events/metrics) so replay can fire again.
 *
 * Usage:
 *   npm run replay:reset
 *   npm run replay:reset -- --wipe
 */
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import {
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../src/services/detection.js";

async function main(): Promise<void> {
  const storeId = env.STORE_ID;
  const wipe = process.argv.includes("--wipe");

  const closed = await resolveOpenIncidents(storeId);
  console.log(
    closed.length
      ? `Resolved ${closed.length} open incident(s): ${closed.map((c) => c.id).join(", ")}`
      : "No open incidents to resolve.",
  );

  if (wipe) {
    const result = await wipeStoreDemoData(storeId);
    console.log(
      `Wiped demo data for ${storeId}: ${result.eventsDeleted} events, ${result.metricsDeleted} metric rows.`,
    );
  } else {
    console.log("Tip: pass --wipe to also delete store events + rolling_metrics.");
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
