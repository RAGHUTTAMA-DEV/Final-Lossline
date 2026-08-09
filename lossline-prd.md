# LOSSLine — PRD & Technical Spec
**TypeScript · Native Function Calling · No Agent Framework · No Memory Framework**

Team: The Operators (Rakshith, Raghuttama, Chandranshu, Gaurav) — Hackverse 2.0, MIT Bengaluru

---

## 1. Product Overview

**One-liner:** LOSSLine correlates fragmented restaurant operations data (orders, prep times, handoffs, cancellations, reviews) to explain *why* a location is bleeding money right now, and recommends a specific fix — not another dashboard.

**Problem:** Multi-location restaurants have POS, delivery, staffing, inventory, and review data sitting in silos. Managers see symptoms (cancellations up, reviews dropping) but not root cause, so they react late.

**Solution:** Deterministic detection flags anomalies → an LLM agent investigates using real tool calls over verified data → a human approves a specific recommended action → the system watches metrics recover and reports whether it actually worked.

---

## 2. Scope

**In scope (hackathon MVP):**
- Single store, simulated/replayed event stream
- One incident type end-to-end: operational overload (order surge → prep delay → cancellations → bad reviews)
- Deterministic detection, tool-calling agent, human approval, simulated action, outcome verification
- Live dashboard with real-time updates

**Explicitly cut:**
- No LangChain / LangGraph / any agent orchestration framework
- No vector DB or memory framework — agent state is just rows in Postgres
- No multi-agent supervisor, no agent-to-agent messaging
- No Kafka, no microservices — one backend + one worker process
- No multi-store, multi-incident-type generalization (structure allows it later, don't build it now)

---

## 3. Architecture Flow

```
Scenario Simulator / CSV replay
            │
            ▼
     POST /api/events  (Fastify)
            │
      ┌─────┴─────┐
      ▼           ▼
 PostgreSQL   Redis Stream
 (truth)      (event handoff)
                   │
                   ▼
          Detection Loop (deterministic, no LLM)
          runs every 5s, reads stream, updates
          rolling metrics, checks thresholds
                   │
                   ▼
            incident created?
                   │ yes
                   ▼
        Investigation Agent Loop
        (native tool calling, MAX_STEPS=6)
                   │
        ┌──────────┼──────────────┐
        ▼          ▼              ▼
   get_metrics  get_baseline  get_related_signals  ...
        │          │              │
        └──────────┴──────────────┘
                   │
                   ▼
        recommendation + explanation
        + deterministic confidence score
                   │
                   ▼
          Human Approval (pause point)
          state persisted → resume on POST /approve
                   │
                   ▼
          execute_action() (simulated)
                   │
                   ▼
          Outcome Poller (every 10s)
          compares before/after metrics
                   │
                   ▼
          RESOLVED / NOT_IMPROVED
                   │
                   ▼
     WebSocket → React/Next.js UI (live updates)
```

Three independent loops, one shared Postgres state machine. No orchestration framework glues them together — each loop is a plain `while(true)` worker that reads/writes DB rows.

---

## 4. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind | existing plan, unchanged |
| Backend | Node.js + TypeScript + Fastify | plain HTTP framework, not an agent framework — fine to use |
| DB | PostgreSQL (Supabase) | durable source of truth for everything, including agent state |
| Event handoff | Redis Streams | frozen from earlier plan, keep it |
| LLM calls | Native SDK tool calling (`Gemini or OpenAI-compatible) | direct API calls, no LangChain wrapper |
| Realtime | WebSocket (`ws`) or SSE | push incident/agent-step updates to UI |
| Deploy | Vercel (frontend) / Railway (backend + worker) / Supabase (DB) | unchanged |

**Watch-out:** if you're using IBM watsonx.ai/Granite for the explanation layer for sponsor-alignment points, confirm it exposes OpenAI-style native tool calling before you build the agent loop against it — if support is shaky under time pressure, keep an Anthropic/OpenAI key as a fallback provider behind the same `LLMClient` interface so you can swap in 5 minutes, not mid-demo.

---

## 5. Data Model (Postgres)

```
events            id, store_id, type, payload jsonb, occurred_at, ingested_at

incidents         id, store_id, type, status, baseline jsonb, created_at
                  status: DETECTED | INVESTIGATING | AWAITING_APPROVAL
                          | APPROVED | EXECUTING | VERIFYING
                          | RESOLVED | NOT_IMPROVED

agent_runs        id, incident_id, step, messages jsonb, created_at
                  -- this table IS your "memory": append-only log of the
                  -- message array sent to the LLM each step. No vector DB.

recommendations   id, incident_id, confidence, explanation text,
                  action_type, estimated_exposure, created_at

actions           id, incident_id, recommendation_id, approved_by,
                  approved_at, executed_at, params jsonb

outcomes          id, incident_id, before jsonb, after jsonb,
                  verdict, evaluated_at
```

`agent_runs.messages` is what makes the approval pause/resume work without a framework: when a human approves, you reload the last row's `messages` array and either continue the loop or move straight to `execute_action()`. That's the entire "memory" system.

---

## 6. The Three Loops

### 6.1 Detection Loop — deterministic, no LLM

```ts
async function detectionLoop() {
  while (true) {
    const events = await readNewFromStream();      // Redis Stream, cursor-based
    await updateRollingMetrics(events);             // writes to Postgres

    const overload = await checkOverloadThresholds(); // pure math, no LLM
    if (overload) {
      await createIncident(overload);
    }

    await sleep(5000);
  }
}
```

### 6.2 Investigation Agent Loop — native function calling

```ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_STEPS = 6;

async function runInvestigationAgent(incidentId: string) {
  const incident = await db.incidents.findById(incidentId);
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildIncidentPrompt(incident) },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages,
    });

    await db.agentRuns.insert({ incidentId, step, messages: [...messages, response] });

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0) {
      const finalText = response.content.find((b) => b.type === "text")?.text ?? "";
      await saveRecommendation(incidentId, finalText);
      return finalText;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUses.map(async (call) => ({
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: JSON.stringify(await executeTool(call.name, call.input)),
      }))
    );

    messages.push({ role: "user", content: toolResults });
  }

  await flagForManualReview(incidentId); // safety net if it never converges
}

async function executeTool(name: string, input: unknown) {
  switch (name) {
    case "get_metrics": return getMetrics(input as GetMetricsInput);
    case "get_recent_events": return getRecentEvents(input as GetRecentEventsInput);
    case "get_baseline": return getBaseline(input as GetBaselineInput);
    case "get_related_signals": return getRelatedSignals(input as GetRelatedSignalsInput);
    case "get_incident_history": return getIncidentHistory(input as GetIncidentHistoryInput);
    case "calculate_revenue_exposure": return calculateRevenueExposure(input as RevenueExposureInput);
    case "get_recommendation_options": return getRecommendationOptions(input as RecommendationInput);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
```

### 6.3 Outcome Polling Loop

```ts
async function outcomePoller(incidentId: string) {
  const incident = await db.incidents.findById(incidentId);

  while (true) {
    const metrics = await getCurrentMetrics(incident.storeId);

    if (enoughData(metrics)) {
      const outcome = evaluateOutcome(incident.baseline, metrics);
      await saveOutcome(incidentId, outcome);
      return outcome;
    }

    await sleep(10000);
  }
}
```

---

## 7. Tools (Function Calling Definitions)

All calculations happen inside these functions — the LLM never computes a number itself, only reasons over what the tools return.

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `get_metrics` | `storeId, metric, windowMinutes` | time series for one metric | order velocity, prep time, cancellation rate, handoff delay |
| `get_recent_events` | `storeId, sinceMinutes` | raw event list | last N minutes of raw events for context |
| `get_baseline` | `storeId, metric` | historical normal range | rolling 7/30-day average + stddev |
| `get_related_signals` | `storeId, incidentId` | correlated signals across metric types | the "5 signals lit up" check |
| `get_incident_history` | `storeId, type` | past incidents of same type | did this happen before, what worked |
| `calculate_revenue_exposure` | `storeId, incidentType, severity` | ₹/hr estimated loss | pure formula, not LLM-estimated |
| `get_recommendation_options` | `incidentType, signals` | list of valid canned actions with params | LLM picks/explains, doesn't invent actions |

Example schema (Anthropic tool format):

```ts
const tools: Anthropic.Tool[] = [
  {
    name: "get_metrics",
    description: "Get current and historical operational metrics for a store.",
    input_schema: {
      type: "object",
      properties: {
        storeId: { type: "string" },
        metric: {
          type: "string",
          enum: ["order_velocity", "prep_time", "cancellation_rate", "handoff_delay"],
        },
        windowMinutes: { type: "number" },
      },
      required: ["storeId", "metric"],
    },
  },
  // ...remaining tools follow the same shape
];
```

---

## 8. Confidence Score — deterministic, not LLM-guessed

The demo mockup shows "Confidence: 87%" — that number must come from a formula, not the model inventing a percentage, or it falls apart the moment a judge asks how it's computed.

```ts
const SIGNAL_WEIGHTS = {
  order_velocity: 0.25,
  prep_time: 0.25,
  handoff_delay: 0.20,
  cancellations: 0.15,
  reviews: 0.15,
} as const;

function calculateConfidence(checked: Signal[], confirmed: Signal[]): number {
  const confirmedWeight = confirmed.reduce((sum, s) => sum + SIGNAL_WEIGHTS[s.type], 0);
  const totalWeight = checked.reduce((sum, s) => sum + SIGNAL_WEIGHTS[s.type], 0);
  return Math.round((confirmedWeight / totalWeight) * 100);
}
```

The agent reports this number via `get_related_signals`; it never generates it in prose.

---

## 9. API Endpoints

```
POST   /api/events                     ingest simulated/replayed events
GET    /api/incidents                  list incidents (dashboard feed)
GET    /api/incidents/:id              incident detail + agent trace
POST   /api/incidents/:id/approve      resume agent_run, trigger execute_action
POST   /api/incidents/:id/reject       close incident, log rejection
GET    /api/incidents/:id/stream       SSE/WS channel for live agent + outcome updates
```

---

## 10. Frontend Screens

1. **Incident feed** — live list, status badges (DETECTED → INVESTIGATING → AWAITING_APPROVAL → RESOLVED)
2. **Investigation trace** — checklist of tool calls as they happen (`✓ Checked order velocity` etc.), streamed via WS
3. **Recommendation card** — root cause, confidence %, estimated exposure, [Approve][Edit][Reject]
4. **Outcome tracker** — before/after metric bars + progress bar during verification window

---

## 11. Phases to Complete

Sized in relative hour-blocks — compress by dropping P1 items first if you have less time than assumed. Suggested 4-way split across the team so loops build in parallel once the schema is agreed.

| Phase | Focus | Est. | Priority | Suggested owner |
|---|---|---|---|---|
| **0 — Foundation** | Postgres schema, Redis stream setup, Fastify skeleton, `LLMClient` interface | ~1–1.5h | P0 | whoever's fastest at infra |
| **1 — Ingestion + Detection** | `/api/events`, rolling metrics, threshold detector, `createIncident` | ~2–3h | P0 | 1 person |
| **2 — Agent Loop + Tools** | all 7 tools, agent loop, `agent_runs` persistence, confidence formula | ~3–4h | P0 | 1–2 people (this is the core, give it the most hands) |
| **3 — Approval + Action + Outcome** | approve/reject endpoints, resume logic, `execute_action`, outcome poller | ~2–3h | P0 | 1 person |
| **4 — Frontend wiring** | incident feed, trace view, recommendation card, WS live updates | ~2–3h | P0 | 1 person, start in parallel once API shapes are frozen |
| **5 — Demo polish** | scripted run-through, seeded synthetic scenario, fallback recording | ~1–2h | P1 | whole team |

P1 cut candidates if time runs short: outcome polling animation, incident history tool, multi-signal review-scraping — hardcode a plausible review snippet instead of a live scraper if reviews integration isn't done yet.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM latency/rate limits during live demo | Pre-run and record one full scenario as a fallback; don't rely on live API calls in front of judges |
| watsonx/Granite tool-calling support unclear | Keep `LLMClient` provider-agnostic; have an Anthropic/OpenAI key ready to swap in |
| Redis Streams eats setup time | Fallback: poll a Postgres `events` table by `id > last_seen` — functionally identical for a single-store demo |
| Agent loop never converges (MAX_STEPS hit) | `flagForManualReview` path exists — never let it hang the UI |
| Team merge conflicts across phases | Freeze API/tool schemas at end of Phase 0 before parallel work starts |

---

## 13. Why this shape

Same reasoning as before, now concretely: deterministic code owns triggers and math (detection thresholds, confidence score, revenue exposure), the LLM owns synthesis and explanation, and the only "framework" in the whole system is Postgres rows plus a `for` loop. That's the version you can actually finish and the version you can defend line-by-line if a judge asks "wait, where's the AI actually doing the work."
