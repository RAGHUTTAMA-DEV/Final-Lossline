/**
 * Replay one Meghana Biryani gold scenario (G1–G6).
 *
 * Usage:
 *   npm run replay:meghana -- G3
 *   npm run replay:meghana -- G1
 */
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import {
  buildMeghanaScenario,
  type ScenarioId,
} from "../src/scenarios/meghana.js";
import {
  detectForStore,
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../src/services/detection.js";
import { insertEvents } from "../src/services/events.js";
import { deriveKitchenState } from "../src/services/kitchenState.js";

async function main(): Promise<void> {
  const id = (process.argv[2] || "G3").toUpperCase() as ScenarioId;
  const allowed = new Set(["G1", "G2", "G3", "G4", "G5", "G6"]);
  if (!allowed.has(id)) {
    throw new Error(`Usage: npm run replay:meghana -- G1|G2|G3|G4|G5|G6`);
  }

  const storeId = env.STORE_ID;
  const built = buildMeghanaScenario(id, storeId);

  await resolveOpenIncidents(storeId);
  const wiped = await wipeStoreDemoData(storeId);
  console.log(`Wiped ${wiped.eventsDeleted} events for ${storeId}`);
  console.log(`\n=== Meghana Biryani · ${built.meta.id} ${built.meta.name} ===`);
  console.log(`Proves: ${built.meta.proves}`);
  console.log(built.meta.story);

  const inserted = await insertEvents(built.events);
  const kitchen = deriveKitchenState(inserted);
  console.log(`Ingested ${inserted.length} events`);
  console.log(`Kitchen root cause: ${kitchen.inferredRootCause}`);
  console.log(`Stockouts:`, kitchen.stockouts);
  console.log(`Staff: ${kitchen.cooksOnFloor}/${kitchen.cooksRequired} (${kitchen.staffingStatus})`);
  console.log(`Oversell:`, kitchen.deliveryOversell);

  const incident = await detectForStore(storeId);
  if (incident) {
    console.log(`DETECTED ${incident.id}`);
    console.log("Reasons:", (incident.baseline as { reasons?: string[] })?.reasons);
  } else {
    console.log("No incident detected (expected for G1).");
  }

  const expect = built.meta.expectIncident;
  const ok = expect ? Boolean(incident) : !incident;
  console.log(ok ? "\n✓ Scenario behaved as expected" : "\n✗ Unexpected detection result");
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
