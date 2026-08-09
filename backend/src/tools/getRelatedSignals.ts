import { z } from "zod";
import { env } from "../config/env.js";
import {
  calculateConfidence,
  type Signal,
  type SignalType,
} from "../services/confidence.js";
import { getIncidentById } from "../services/detection.js";
import { deriveKitchenState } from "../services/kitchenState.js";
import { computeMetricsFromEvents } from "../services/metrics.js";
import { getEventsSince } from "../services/events.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  incidentId: z.string().uuid(),
});

export async function getRelatedSignals(raw: unknown) {
  const input = inputSchema.parse(raw);
  const incident = await getIncidentById(input.incidentId);
  if (!incident) {
    return { error: "incident_not_found", incidentId: input.incidentId };
  }

  const since = new Date(Date.now() - 15 * 60_000);
  const events = await getEventsSince(input.storeId, since);
  const short = computeMetricsFromEvents(events, 15);

  const longSince = new Date(Date.now() - 60 * 60_000);
  const longEvents = await getEventsSince(input.storeId, longSince);
  const long = computeMetricsFromEvents(longEvents, 60);
  const baselineVelocity = Math.max(long.order_velocity, 0.05);
  const velocitySpike = short.order_velocity / baselineVelocity;
  const kitchen = deriveKitchenState(longEvents);

  const checked: Signal[] = [
    { type: "order_velocity" },
    { type: "prep_time" },
    { type: "handoff_delay" },
    { type: "cancellations" },
    { type: "reviews" },
    { type: "inventory_shortage" },
    { type: "staffing_shortfall" },
    { type: "delivery_oversell" },
  ];

  const confirmed: Signal[] = [];
  const details: Record<string, unknown> = {};

  if (velocitySpike >= env.THRESHOLD_ORDER_VELOCITY_SPIKE && short.order_count >= 3) {
    confirmed.push({ type: "order_velocity" });
    details.order_velocity = { velocitySpike, short: short.order_velocity, baseline: baselineVelocity };
  }

  if (short.prep_time >= env.THRESHOLD_PREP_TIME_MINUTES && short.prep_samples >= 2) {
    confirmed.push({ type: "prep_time" });
    details.prep_time = { value: short.prep_time, threshold: env.THRESHOLD_PREP_TIME_MINUTES };
  }

  if (short.handoff_delay >= env.THRESHOLD_HANDOFF_DELAY_MINUTES && short.handoff_samples >= 2) {
    confirmed.push({ type: "handoff_delay" });
    details.handoff_delay = {
      value: short.handoff_delay,
      threshold: env.THRESHOLD_HANDOFF_DELAY_MINUTES,
    };
  }

  if (short.cancellation_rate >= env.THRESHOLD_CANCEL_RATE && short.order_count >= 3) {
    confirmed.push({ type: "cancellations" });
    details.cancellations = {
      rate: short.cancellation_rate,
      threshold: env.THRESHOLD_CANCEL_RATE,
    };
  }

  // Reviews: confirm if any recent 1–2 star reviews exist
  const badReviews = events.filter((e) => {
    if (e.type !== "review") return false;
    const rating = e.payload.rating;
    return typeof rating === "number" && rating <= 2;
  });
  if (badReviews.length > 0) {
    confirmed.push({ type: "reviews" });
    details.reviews = { badReviewCount: badReviews.length };
  }

  if (
    kitchen.stockouts.length > 0 ||
    kitchen.inferredRootCause === "inventory_shortage" ||
    kitchen.inferredRootCause === "inventory_shortage_recovering"
  ) {
    confirmed.push({ type: "inventory_shortage" });
    details.inventory_shortage = {
      stockouts: kitchen.stockouts,
      replenishments: kitchen.replenishments,
      recovering: kitchen.inferredRootCause === "inventory_shortage_recovering",
    };
  }

  if (
    kitchen.inferredRootCause === "staffing_shortfall" ||
    kitchen.staffingStatus === "shortfall"
  ) {
    confirmed.push({ type: "staffing_shortfall" });
    details.staffing_shortfall = {
      cooksOnFloor: kitchen.cooksOnFloor,
      required: kitchen.cooksRequired,
      status: kitchen.staffingStatus,
    };
  }

  if (kitchen.deliveryOversell.length > 0) {
    confirmed.push({ type: "delivery_oversell" });
    details.delivery_oversell = kitchen.deliveryOversell;
  }

  const confidence = calculateConfidence(checked, confirmed);

  return {
    storeId: input.storeId,
    incidentId: input.incidentId,
    brand: "Meghana Biryani",
    checked: checked.map((s) => s.type),
    confirmed: confirmed.map((s) => s.type as SignalType),
    confidence,
    details,
    metrics_15m: short,
    kitchen,
    rootCauseHint: kitchen.inferredRootCause,
  };
}
