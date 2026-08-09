import { Router } from "express";
import { z } from "zod";
import { createLLMClient } from "../llm/index.js";
import { listIncidents } from "../services/detection.js";
import { getLatestRecommendation } from "../services/recommendations.js";
import { updateRollingMetrics } from "../services/metrics.js";
import { env } from "../config/env.js";

export const copilotRouter = Router();

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(12)
    .optional()
    .default([]),
  /** Optional client-built dashboard snapshot for tighter answers. */
  context: z.record(z.unknown()).optional(),
});

async function buildServerContext() {
  const incidents = await listIncidents(30);
  const open = incidents.filter((i) =>
    [
      "DETECTED",
      "INVESTIGATING",
      "AWAITING_APPROVAL",
      "APPROVED",
      "EXECUTING",
      "VERIFYING",
    ].includes(i.status),
  );

  const alerts = [];
  for (const inc of open.slice(0, 8)) {
    const rec = await getLatestRecommendation(inc.id);
    alerts.push({
      id: inc.id,
      storeId: inc.storeId,
      status: inc.status,
      type: inc.type,
      reasons: Array.isArray(inc.baseline?.reasons)
        ? inc.baseline.reasons
        : [],
      recommendation: rec
        ? {
            actionType: rec.actionType,
            confidence: rec.confidence,
            explanation: rec.explanation,
            estimatedExposure: rec.estimatedExposure,
          }
        : null,
    });
  }

  const { short, long } = await updateRollingMetrics(env.STORE_ID);

  return {
    storeId: env.STORE_ID,
    metrics15m: short,
    metrics60m: long,
    openIncidentCount: open.length,
    alerts,
  };
}

function fallbackAnswer(
  message: string,
  serverCtx: Awaited<ReturnType<typeof buildServerContext>>,
  clientCtx: Record<string, unknown> | undefined,
): string {
  const q = message.toLowerCase();
  const exposure =
    (clientCtx?.estimatedExposure as number | undefined) ??
    serverCtx.alerts.reduce(
      (s, a) => s + Number(a.recommendation?.estimatedExposure ?? 0),
      0,
    );
  const active = serverCtx.openIncidentCount;

  if (q.includes("revenue") || q.includes("exposure") || q.includes("risk")) {
    return `Revenue at risk is about ₹${Number(exposure).toLocaleString("en-IN")} across ${active} open incident(s) on ${serverCtx.storeId}. Highest drivers are open overload alerts waiting on investigate/approve.`;
  }
  if (q.includes("alert") || q.includes("incident")) {
    if (!serverCtx.alerts.length) {
      return "No active alerts right now. Seed an overload burst or wait for the detection worker to flag signals.";
    }
    const top = serverCtx.alerts[0];
    return `Top alert: ${top.type} at ${top.storeId} (${top.status}). ${
      top.recommendation?.explanation ||
      (top.reasons.length ? top.reasons.join("; ") : "Threshold signals fired.")
    }`;
  }
  if (q.includes("prep") || q.includes("cancel") || q.includes("metric")) {
    const m = serverCtx.metrics15m;
    return `Last 15m on ${serverCtx.storeId}: velocity ${Number(m.order_velocity).toFixed(2)}/min, prep ${Number(m.prep_time).toFixed(1)}m, cancel ${(Number(m.cancellation_rate) * 100).toFixed(1)}%, handoff ${Number(m.handoff_delay).toFixed(1)}m.`;
  }
  if (q.includes("jayanagar") || q.includes("better") || q.includes("compare")) {
    const cmp = clientCtx?.locationCompare as
      | {
          winner?: string | null;
          scoreA?: number;
          scoreB?: number;
          a?: { storeId: string; name: string };
          b?: { storeId: string; name: string };
          reasons?: Array<{ note: string }>;
        }
      | undefined;
    if (cmp?.reasons?.length) {
      const winner =
        cmp.winner === cmp.a?.storeId
          ? cmp.a?.name ?? "A"
          : cmp.winner === cmp.b?.storeId
            ? cmp.b?.name ?? "B"
            : "Neither clearly";
      return `${winner} leads on health (${cmp.scoreA} vs ${cmp.scoreB}). ${cmp.reasons
        .slice(0, 3)
        .map((r) => r.note)
        .join(" ")} Open Locations for full charts.`;
    }
    return "Open Location Analytics and compare Jayanagar vs Koramangala — scores come from reviews, cancels, prep, and stockouts.";
  }
  if (q.includes("branch") || q.includes("location") || q.includes("outlet")) {
    return `Primary live outlet is ${serverCtx.storeId} with ${active} open incident(s). Seeded analytics cover Koramangala, Jayanagar, and Indiranagar — open the Locations page to compare.`;
  }

  return `I see ${active} open incident(s) and ~₹${Number(exposure).toLocaleString("en-IN")} exposure on ${serverCtx.storeId}. Ask about alerts, metrics, revenue at risk, or a branch — or set GEMINI_API_KEY for fuller Copilot answers.`;
}

copilotRouter.post("/api/copilot", async (req, res) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid copilot payload", details: parsed.error.flatten() });
      return;
    }

    const { message, history, context } = parsed.data;
    const serverCtx = await buildServerContext();

    let reply: string;
    let provider: "gemini" | "fallback" = "fallback";

    try {
      const llm = createLLMClient();
      const system = [
        "You are LOSSLine AI Copilot for Meghana Biryani (Koramangala + sister outlets).",
        "Answer briefly (2–6 sentences). Use only the CONTEXT JSON. Prefer concrete numbers, scenario IDs (G1–G6), root causes, and recommended actions.",
        "Gold distinctions: stockout ≠ staffing ≠ delivery oversell ≠ capacity pressure. G1 must stay quiet (no false shortage).",
        "If data is missing, say what is unknown. Do not invent incidents. Currency is INR (₹).",
        "CONTEXT:",
        JSON.stringify({ server: serverCtx, dashboard: context ?? null }, null, 0),
      ].join("\n");

      const messages = [
        ...history.slice(-8).map((h) => ({
          role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
          content: h.content,
        })),
        { role: "user" as const, content: message },
      ];

      const response = await llm.chat({ system, messages });
      reply =
        response.text?.trim() ||
        fallbackAnswer(message, serverCtx, context as Record<string, unknown> | undefined);
      provider = "gemini";
    } catch (err) {
      console.warn(
        "[copilot] LLM unavailable, using fallback:",
        err instanceof Error ? err.message : err,
      );
      reply = fallbackAnswer(
        message,
        serverCtx,
        context as Record<string, unknown> | undefined,
      );
    }

    res.json({
      reply,
      provider,
      contextUsed: {
        storeId: serverCtx.storeId,
        openIncidentCount: serverCtx.openIncidentCount,
      },
    });
  } catch (err) {
    console.error("[copilot] failed:", err);
    res.status(500).json({ error: "Copilot failed" });
  }
});
