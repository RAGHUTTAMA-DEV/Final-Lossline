/**
 * Phase 3 smoke: seed overload → (reuse existing AWAITING_APPROVAL or investigate)
 * → approve → force outcome → RESOLVED.
 *
 * Usage:
 *   npm run smoke:approve              # full path including Gemini if needed
 *   npm run smoke:approve -- --reuse   # approve latest AWAITING_APPROVAL only
 */
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import { runInvestigationAgent } from "../src/loops/investigation.js";
import { evaluateVerifyingIncident } from "../src/loops/outcome.js";
import { getLatestAction } from "../src/services/actions.js";
import { approveIncident } from "../src/services/approval.js";
import {
  detectForStore,
  getIncidentById,
  listIncidents,
  resolveOpenIncidents,
  wipeStoreDemoData,
} from "../src/services/detection.js";
import { insertEvents, type IngestEventInput } from "../src/services/events.js";
import { getLatestOutcome } from "../src/services/outcomes.js";
import { getLatestRecommendation } from "../src/services/recommendations.js";
import { sleep } from "../src/utils/sleep.js";

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

async function ensureAwaitingApproval(): Promise<string> {
  const reuse = process.argv.includes("--reuse");
  if (reuse) {
    const open = await listIncidents(20);
    const hit = open.find((i) => i.status === "AWAITING_APPROVAL");
    if (!hit) {
      throw new Error("No AWAITING_APPROVAL incident to reuse");
    }
    console.log("Reusing", hit.id);
    return hit.id;
  }

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
  console.log("Investigation:", result);
  if (result.status !== "AWAITING_APPROVAL") {
    throw new Error(`Expected AWAITING_APPROVAL, got ${result.status}`);
  }
  return incident.id;
}

async function main(): Promise<void> {
  const incidentId = await ensureAwaitingApproval();
  const rec = await getLatestRecommendation(incidentId);
  console.log("Recommendation:", rec);

  console.log("Approving…");
  const approved = await approveIncident(incidentId, {
    approvedBy: "smoke_operator",
  });
  console.log("Approved →", approved.incident.status, {
    actionId: approved.action.id,
    recoveryEvents: approved.recoveryEvents,
  });

  // Brief wait so recovery timestamps are in the past relative to evaluation
  await sleep(3500);

  console.log("Forcing outcome evaluation…");
  const tick = await evaluateVerifyingIncident(incidentId, { force: true });
  const final = await getIncidentById(incidentId);
  const action = await getLatestAction(incidentId);
  const outcome = await getLatestOutcome(incidentId);

  console.log("Outcome tick:", tick);
  console.log("Final status:", final?.status);
  console.log("Action:", action);
  console.log("Outcome:", outcome);

  if (final?.status !== "RESOLVED" && final?.status !== "NOT_IMPROVED") {
    throw new Error(`Expected terminal status, got ${final?.status}`);
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
