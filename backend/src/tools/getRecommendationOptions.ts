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
    when: "High order velocity + rising cancellations",
  },
  {
    action_type: "call_in_prep_staff",
    label: "Call in extra prep staff",
    params: { heads: 1, role: "prep" },
    when: "Prep time above threshold",
  },
  {
    action_type: "extend_prep_eta",
    label: "Extend quoted prep ETA on channels",
    params: { extraMinutes: 15 },
    when: "Handoff delay or prep backlog",
  },
  {
    action_type: "throttle_new_orders",
    label: "Throttle new POS / QR orders",
    params: { maxConcurrent: 8 },
    when: "Sustained velocity spike",
  },
];

export async function getRecommendationOptions(raw: unknown) {
  const input = inputSchema.parse(raw);
  const signals = new Set(input.signals.map((s) => s.toLowerCase()));

  const ranked = [...OVERLOAD_OPTIONS]
    .map((opt) => {
      let score = 0;
      if (signals.has("cancellations") && opt.action_type === "pause_delivery") score += 3;
      if (signals.has("prep_time") && opt.action_type === "call_in_prep_staff") score += 3;
      if (signals.has("handoff_delay") && opt.action_type === "extend_prep_eta") score += 2;
      if (signals.has("order_velocity") && opt.action_type === "throttle_new_orders") score += 2;
      return { opt, score };
    })
    .sort((a, b) => b.score - a.score);

  return {
    incidentType: input.incidentType,
    signals: input.signals,
    options: ranked.map(({ opt }) => opt),
    note: "Pick exactly one action_type from options. Do not invent new action types.",
  };
}
