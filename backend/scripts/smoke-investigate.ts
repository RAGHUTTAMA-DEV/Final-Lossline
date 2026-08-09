/**
 * End-to-end Phase 2 smoke: fresh overload → investigate with Gemini.
 *
 * Usage: npm run smoke:investigate
 */
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import { runInvestigationAgent } from "../src/loops/investigation.js";
import {
  detectForStore,
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../src/services/detection.js";
import { insertEvents, type IngestEventInput } from "../src/services/events.js";
import { getLatestRecommendation } from "../src/services/recommendations.js";
import { listAgentRuns } from "../src/services/agentRuns.js";

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

async function seedOverload(storeId: string): Promise<void> {
  const events: IngestEventInput[] = [];
  for (let i = 0; i < 12; i += 1) {
    events.push({
      storeId,
      type: "order",
      payload: { orderId: `ord_${i}`, amount: 350 + i * 10 },
      occurredAt: minutesAgo(14 - i),
    });
  }
  for (let i = 0; i < 5; i += 1) {
    events.push({
      storeId,
      type: "prep_complete",
      payload: { orderId: `ord_${i}`, prepMinutes: 22 + i },
      occurredAt: minutesAgo(10 - i),
    });
  }
  for (let i = 0; i < 4; i += 1) {
    events.push({
      storeId,
      type: "handoff",
      payload: { orderId: `ord_${i}`, delayMinutes: 10 + i },
      occurredAt: minutesAgo(8 - i),
    });
  }
  for (const i of [1, 3, 5]) {
    events.push({
      storeId,
      type: "cancellation",
      payload: { orderId: `ord_${i}`, reason: "too_long_wait" },
      occurredAt: minutesAgo(6 - i * 0.2),
    });
  }
  for (let i = 0; i < 2; i += 1) {
    events.push({
      storeId,
      type: "order",
      payload: { orderId: `old_${i}`, amount: 300 },
      occurredAt: minutesAgo(50 + i),
    });
  }
  await insertEvents(events);
}

async function main(): Promise<void> {
  const storeId = env.STORE_ID;
  await resolveOpenIncidents(storeId);
  await wipeStoreDemoData(storeId);
  console.log("Seeding overload…");
  await seedOverload(storeId);

  const incident = await detectForStore(storeId);
  if (!incident) {
    throw new Error("Failed to create DETECTED incident");
  }
  console.log("DETECTED", incident.id);

  console.log("Running Gemini investigation…");
  const result = await runInvestigationAgent(incident.id);
  const runs = await listAgentRuns(incident.id);
  const rec = await getLatestRecommendation(incident.id);

  console.log("Result:", result);
  console.log("Agent steps:", runs.length);
  console.log("Recommendation:", rec);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
