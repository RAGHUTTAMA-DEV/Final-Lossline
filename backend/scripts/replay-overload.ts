/**
 * Seed a short operational-overload burst, then run detection once.
 *
 * Usage:
 *   npm run replay:overload
 *   npm run replay:overload -- --reset
 *   npm run replay:overload -- --reset --wipe
 */
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import {
  detectForStore,
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../src/services/detection.js";
import { insertEvents, type IngestEventInput } from "../src/services/events.js";

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

async function main(): Promise<void> {
  const storeId = env.STORE_ID;
  const reset = process.argv.includes("--reset");
  const wipe = process.argv.includes("--wipe");

  if (reset || wipe) {
    const closed = await resolveOpenIncidents(storeId);
    console.log(
      closed.length
        ? `Reset: resolved ${closed.length} open incident(s).`
        : "Reset: no open incidents.",
    );
  }
  if (wipe) {
    const result = await wipeStoreDemoData(storeId);
    console.log(
      `Wipe: ${result.eventsDeleted} events, ${result.metricsDeleted} metric rows removed.`,
    );
  }

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

  console.log(`Ingesting ${events.length} events for ${storeId}…`);
  await insertEvents(events);

  console.log("Running detection…");
  const incident = await detectForStore(storeId);
  if (incident) {
    console.log("DETECTED:", incident.id, incident.status);
    console.log(
      "Baseline reasons:",
      (incident.baseline as { reasons?: string[] })?.reasons,
    );
  } else {
    console.log(
      "No new incident (thresholds not met, or open incident already exists). Try: npm run replay:overload -- --reset --wipe",
    );
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
