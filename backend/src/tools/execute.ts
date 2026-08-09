import { calculateRevenueExposure } from "./calculateRevenueExposure.js";
import { getBaseline } from "./getBaseline.js";
import { getIncidentHistory } from "./getIncidentHistory.js";
import { getMetrics } from "./getMetrics.js";
import { getRecentEvents } from "./getRecentEvents.js";
import { getRecommendationOptions } from "./getRecommendationOptions.js";
import { getRelatedSignals } from "./getRelatedSignals.js";

export async function executeTool(
  name: string,
  input: unknown,
): Promise<unknown> {
  switch (name) {
    case "get_metrics":
      return getMetrics(input);
    case "get_recent_events":
      return getRecentEvents(input);
    case "get_baseline":
      return getBaseline(input);
    case "get_related_signals":
      return getRelatedSignals(input);
    case "get_incident_history":
      return getIncidentHistory(input);
    case "calculate_revenue_exposure":
      return calculateRevenueExposure(input);
    case "get_recommendation_options":
      return getRecommendationOptions(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
