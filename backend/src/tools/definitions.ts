import type { ToolDef } from "../llm/types.js";

/** Gemini-native tool definitions (JSON Schema parameters). */
export const investigationTools: ToolDef[] = [
  {
    name: "get_metrics",
    description:
      "Get current operational metrics for a store over a time window. Metrics: order_velocity, prep_time, cancellation_rate, handoff_delay.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string", description: "Store identifier" },
        metric: {
          type: "string",
          enum: ["order_velocity", "prep_time", "cancellation_rate", "handoff_delay"],
        },
        windowMinutes: {
          type: "number",
          description: "Lookback window in minutes (default 15)",
        },
      },
      required: ["storeId", "metric"],
    },
  },
  {
    name: "get_recent_events",
    description: "List raw operational events for a store in the last N minutes.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        sinceMinutes: {
          type: "number",
          description: "Lookback in minutes (default 30, max 180)",
        },
      },
      required: ["storeId"],
    },
  },
  {
    name: "get_baseline",
    description:
      "Get historical normal range (mean/stddev style) for a metric over a longer window.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        metric: {
          type: "string",
          enum: ["order_velocity", "prep_time", "cancellation_rate", "handoff_delay"],
        },
      },
      required: ["storeId", "metric"],
    },
  },
  {
    name: "get_related_signals",
    description:
      "Check correlated overload signals for this incident. Returns checked/confirmed signals and a deterministic confidence percentage — use this confidence, do not invent one.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        incidentId: { type: "string" },
      },
      required: ["storeId", "incidentId"],
    },
  },
  {
    name: "get_incident_history",
    description: "Past incidents of the same type for this store, and what actions were recommended.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        type: {
          type: "string",
          description: "Incident type (default operational_overload)",
        },
      },
      required: ["storeId"],
    },
  },
  {
    name: "calculate_revenue_exposure",
    description:
      "Calculate estimated revenue loss in INR per hour from severity inputs. Pure formula — do not invent the number.",
    parameters: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        incidentType: { type: "string" },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
      },
      required: ["storeId", "incidentType", "severity"],
    },
  },
  {
    name: "get_recommendation_options",
    description:
      "List valid canned corrective actions for this incident type. You must pick one of these action_type values — do not invent new actions.",
    parameters: {
      type: "object",
      properties: {
        incidentType: { type: "string" },
        signals: {
          type: "array",
          items: { type: "string" },
          description: "Confirmed signal names",
        },
      },
      required: ["incidentType"],
    },
  },
];
