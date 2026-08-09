export type SignalType =
  | "order_velocity"
  | "prep_time"
  | "handoff_delay"
  | "cancellations"
  | "reviews";

export interface Signal {
  type: SignalType;
}

export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  order_velocity: 0.25,
  prep_time: 0.25,
  handoff_delay: 0.2,
  cancellations: 0.15,
  reviews: 0.15,
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
