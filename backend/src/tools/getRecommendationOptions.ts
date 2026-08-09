import { z } from "zod";

const inputSchema = z.object({
  incidentType: z.string().min(1),
  signals: z.array(z.string()).optional().default([]),
});

export interface RecommendationOption {
  action_type: string;
  label: string;
  params: Record<string, unknown>;
  when: string;
}

const OVERLOAD_OPTIONS: RecommendationOption[] = [
  {
    action_type: "pause_delivery",
    label: "Temporarily pause delivery / aggregator intake",
    params: { durationMinutes: 20 },
    when: "Delivery oversell or high velocity + cancellations",
  },
  {
    action_type: "call_in_prep_staff",
    label: "Call in extra prep staff",
    params: { heads: 2, role: "prep" },
    when: "Staffing shortfall or prep time above threshold",
  },
  {
    action_type: "extend_prep_eta",
    label: "Extend quoted prep ETA on channels",
    params: { extraMinutes: 15 },
    when: "Handoff delay, replenishment lag, or prep backlog",
  },
  {
    action_type: "throttle_new_orders",
    label: "Throttle new POS / QR / aggregator orders",
    params: { maxConcurrent: 8 },
    when: "Capacity pressure with inventory still OK",
  },
  {
    action_type: "emergency_stock_transfer",
    label: "Emergency stock transfer (Chicken Dum / hero SKU)",
    params: { sku: "chicken_dum", qty: 40, from: "hsr_hub" },
    when: "Inventory shortage / stockout on hero biryani SKU",
  },
  {
    action_type: "eighty_six_sku",
    label: "86 SKU on aggregators until replenished",
    params: { sku: "chicken_dum", channels: ["swiggy", "zomato"] },
    when: "Stockout still showing as orderable on delivery apps",
  },
];

export async function getRecommendationOptions(raw: unknown) {
  const input = inputSchema.parse(raw);
  const signals = new Set(input.signals.map((s) => s.toLowerCase()));

  const ranked = [...OVERLOAD_OPTIONS]
    .map((opt) => {
      let score = 0;
      if (signals.has("delivery_oversell") && opt.action_type === "pause_delivery") score += 5;
      if (signals.has("cancellations") && opt.action_type === "pause_delivery") score += 2;
      if (signals.has("staffing_shortfall") && opt.action_type === "call_in_prep_staff") score += 5;
      if (signals.has("prep_time") && opt.action_type === "call_in_prep_staff") score += 2;
      if (signals.has("inventory_shortage") && opt.action_type === "emergency_stock_transfer")
        score += 5;
      if (signals.has("inventory_shortage") && opt.action_type === "eighty_six_sku") score += 4;
      if (signals.has("handoff_delay") && opt.action_type === "extend_prep_eta") score += 2;
      if (signals.has("order_velocity") && opt.action_type === "throttle_new_orders") score += 2;
      // Prefer throttle over pause when inventory explicitly OK / capacity pressure
      if (
        signals.has("order_velocity") &&
        !signals.has("inventory_shortage") &&
        !signals.has("delivery_oversell") &&
        opt.action_type === "throttle_new_orders"
      ) {
        score += 2;
      }
      return { opt, score };
    })
    .sort((a, b) => b.score - a.score);

  return {
    incidentType: input.incidentType,
    signals: input.signals,
    options: ranked.map(({ opt }) => opt),
    note: "Pick exactly one action_type from options. Prefer Meghana root-cause fit: stockout→transfer/86, staffing→call staff, oversell→pause delivery, capacity+stock OK→throttle.",
  };
}
