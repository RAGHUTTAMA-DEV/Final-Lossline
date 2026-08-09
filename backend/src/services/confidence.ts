export type SignalType =
  | "order_velocity"
  | "prep_time"
  | "handoff_delay"
  | "cancellations"
  | "reviews"
  | "inventory_shortage"
  | "staffing_shortfall"
  | "delivery_oversell";

export interface Signal {
  type: SignalType;
}

export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  order_velocity: 0.18,
  prep_time: 0.18,
  handoff_delay: 0.12,
  cancellations: 0.12,
  reviews: 0.1,
  inventory_shortage: 0.14,
  staffing_shortfall: 0.1,
  delivery_oversell: 0.06,
};

/** Deterministic confidence — never LLM-guessed. */
export function calculateConfidence(
  checked: Signal[],
  confirmed: Signal[],
): number {
  if (checked.length === 0) return 0;
  const confirmedWeight = confirmed.reduce(
    (sum, s) => sum + (SIGNAL_WEIGHTS[s.type] ?? 0),
    0,
  );
  const totalWeight = checked.reduce(
    (sum, s) => sum + (SIGNAL_WEIGHTS[s.type] ?? 0),
    0,
  );
  if (totalWeight <= 0) return 0;
  return Math.round((confirmedWeight / totalWeight) * 100);
}
