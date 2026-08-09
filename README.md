# LOSSLine

Correlates fragmented restaurant ops data (orders, prep, handoffs, cancellations, reviews) to explain **why a location is bleeding money right now**, and recommends a specific fix — not another dashboard.

**Team:** The Operators (Rakshith, Raghuttama, Chandranshu, Gaurav) · Hackverse 2.0, MIT Bengaluru

## How it works

1. **Detect** — deterministic thresholds on rolling metrics (no LLM)
2. **Investigate** — Gemini agent with native tool calls over real data
3. **Approve** — human pause point before any action
4. **Verify** — outcome poller checks whether metrics actually recovered

No LangChain, no vector DB, no agent framework — agent state is Postgres rows + a loop.

## Stack

| Layer | Choice |
|---|---|
| API + worker | Express · TypeScript · Node 20+ |
| DB | Neon Postgres |
| Event handoff | Redis Streams (optional; Postgres poll fallback) |
| LLM | Gemini (`gemini-2.5-flash`) |
| Frontend | Next.js dashboard — Phase 4 (not started) |

## Repo layout

```
final-lossline/
├── backend/           # API + detection/investigation/outcome worker
├── lossline-prd.md    # Product & technical spec
├── PROGRESS.md        # Phase status & runbook notes
└── README.md
```

## Status

| Phase | Focus | Status |
|---|---|---|
| 0 — Foundation | Express, Neon schema, Redis, Gemini client | Done |
| 1 — Ingestion + Detection | Events, rolling metrics, `DETECTED` | Done |
| 2 — Agent + Tools | 7 tools, investigation → `AWAITING_APPROVAL` | Done |
| 3 — Approval + Outcome | Approve/reject, execute, verify | Done |
| 4 — Frontend | Incident feed, trace, recommendation UI | Next |
| 5 — Demo polish | Scripted run-through | Not started |

Details: [PROGRESS.md](./PROGRESS.md) · Spec: [lossline-prd.md](./lossline-prd.md)

## Quick start (backend)

```bash
cd backend
cp .env.example .env
# set DATABASE_URL (Neon pooled URL + ?sslmode=require)
# set GEMINI_API_KEY for investigation

npm install
npm run db:migrate

# Terminal A — API
npm run dev

# Terminal B — worker (detection + investigation + outcome)
npm run dev:worker
```

Health check: `GET http://localhost:3001/health`

### End-to-end smoke

```bash
npm run replay:fresh        # overload → DETECTED
npm run smoke:investigate   # → Gemini → AWAITING_APPROVAL
npm run smoke:approve       # → VERIFYING → RESOLVED / NOT_IMPROVED
```

Full scripts, API examples, and layout: [backend/README.md](./backend/README.md)

## Environment

Copy from [`backend/.env.example`](./backend/.env.example). Required for a full demo:

- `DATABASE_URL` — Neon Postgres
- `GEMINI_API_KEY` — investigation loop
- `REDIS_URL` — optional; system falls back to Postgres polling
