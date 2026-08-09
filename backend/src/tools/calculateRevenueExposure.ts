import { z } from "zod";
import { computeMetricsFromEvents } from "../services/metrics.js";
import { getEventsSince } from "../services/events.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  incidentType: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

const SEVERITY_MULTIPLIER = {
  low: 0.5,
  medium: 1,
  high: 1.6,
  critical: 2.2,
} as const;

const DEFAULT_AOV_INR = 380;

/**
 * Pure formula: cancel-driven loss + delay friction.
 * INR / hour — never LLM-estimated.
 */
export async function calculateRevenueExposure(raw: unknown) {
  const input = inputSchema.parse(raw);
  const since = new Date(Date.now() - 15 * 60_000);
  const events = await getEventsSince(input.storeId, since);
  const snap = computeMetricsFromEvents(events, 15);

  const ordersPerHour = snap.order_velocity * 60;
  const aov = DEFAULT_AOV_INR;
  const cancelLossPerHour = ordersPerHour * snap.cancellation_rate * aov;

  // Friction: prep/handoff overage reduces throughput ~2% per excess minute (capped)
  const prepOverage = Math.max(0, snap.prep_time - 12);
  const handoffOverage = Math.max(0, snap.handoff_delay - 4);
  const frictionFactor = Math.min(0.4, (prepOverage + handoffOverage) * 0.02);
  const frictionLossPerHour = ordersPerHour * aov * frictionFactor;

  const base = cancelLossPerHour + frictionLossPerHour;
  const inrPerHour = Math.round(base * SEVERITY_MULTIPLIER[input.severity]);

  return {
    storeId: input.storeId,
    incidentType: input.incidentType,
    severity: input.severity,
    currency: "INR",
    estimatedExposurePerHour: inrPerHour,
    breakdown: {
      aov,
      ordersPerHour: round2(ordersPerHour),
      cancellationRate: snap.cancellation_rate,
      cancelLossPerHour: Math.round(cancelLossPerHour),
      frictionLossPerHour: Math.round(frictionLossPerHour),
      severityMultiplier: SEVERITY_MULTIPLIER[input.severity],
    },
    formula:
      "(orders/hr * cancel_rate * AOV) + (orders/hr * AOV * friction) × severity_multiplier",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
