export const INCIDENT_STATUSES = [
  "DETECTED",
  "INVESTIGATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
  "RESOLVED",
  "NOT_IMPROVED",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const EVENT_TYPES = [
  "order",
  "prep_complete",
  "handoff",
  "cancellation",
  "review",
  "inventory_snapshot",
  "staffing_snapshot",
  "replenishment",
  "delivery_accept",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const METRIC_TYPES = [
  "order_velocity",
  "prep_time",
  "cancellation_rate",
  "handoff_delay",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export const INCIDENT_TYPES = ["operational_overload"] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const OUTCOME_VERDICTS = ["RESOLVED", "NOT_IMPROVED"] as const;

export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

export interface StoreEvent {
  id: string;
  storeId: string;
  type: EventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
  ingestedAt: Date;
}

export interface Incident {
  id: string;
  storeId: string;
  type: IncidentType;
  status: IncidentStatus;
  baseline: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRun {
  id: string;
  incidentId: string;
  step: number;
  messages: unknown;
  createdAt: Date;
}

export interface Recommendation {
  id: string;
  incidentId: string;
  confidence: number;
  explanation: string;
  actionType: string;
  estimatedExposure: number | null;
  createdAt: Date;
}

export interface ActionRecord {
  id: string;
  incidentId: string;
  recommendationId: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  params: Record<string, unknown> | null;
}

export interface Outcome {
  id: string;
  incidentId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  verdict: OutcomeVerdict;
  evaluatedAt: Date;
}

export interface RollingMetric {
  storeId: string;
  metric: MetricType;
  windowMinutes: number;
  value: Record<string, unknown>;
  updatedAt: Date;
}
