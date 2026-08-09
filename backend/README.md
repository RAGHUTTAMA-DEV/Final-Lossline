# LOSSLine Backend

Express + TypeScript API for operational overload detection, Gemini-powered investigation, human approval, and outcome verification.

**Progress:** see [`../PROGRESS.md`](../PROGRESS.md)

**Phase 0:** foundation — Express, Neon schema, Redis helpers, Gemini client.  
**Phase 1:** ingestion + deterministic detection → `DETECTED` incidents.  
**Phase 2:** Gemini agent loop + 7 tools → `AWAITING_APPROVAL`.  
**Phase 3:** approve / reject / simulated execute / outcome poller → `RESOLVED` | `NOT_IMPROVED`.  
**Phase 4:** simple HTML UI at `/` + `/agent.html` (agent-loop graph).  
**Location analytics:** `/location.html` — per-outlet POS / reviews / inventory + Jayanagar vs Koramangala compare.

## Quick start

```bash
cp .env.example .env
# set DATABASE_URL to your Neon connection string (Dashboard → Connection Details)
# prefer the pooled URL with ?sslmode=require
# REDIS_URL optional (falls back to Postgres polling); GEMINI_API_KEY for Phase 2+

npm install
npm run db:migrate
npm run seed:portfolio   # 7-day history for Koramangala + Jayanagar + Indiranagar
npm run dev          # API + UI :3001
npm run dev:worker   # detection + investigation + outcome
```

Then:
- UI: `http://localhost:3001/` (dashboard) · `http://localhost:3001/location.html` (outlets) · `http://localhost:3001/agent.html` (agent loop)
- Health: `GET http://localhost:3001/health`

### Phase 1–3 smoke

```bash
# Terminal A: API
npm run dev

# Terminal B: worker
npm run dev:worker

# Overload → DETECTED
npm run replay:fresh

# DETECTED → Gemini → AWAITING_APPROVAL
npm run smoke:investigate

# AWAITING_APPROVAL → approve → VERIFYING → RESOLVED (or NOT_IMPROVED)
npm run smoke:approve
# or reuse an existing awaiting incident:
npm run smoke:approve -- --reuse

# Inspect
curl http://localhost:3001/api/incidents
```

### Approval API

```bash
# Approve (body optional)
curl -X POST http://localhost:3001/api/incidents/:id/approve \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"manager"}'

# Reject
curl -X POST http://localhost:3001/api/incidents/:id/reject \
  -H 'content-type: application/json' \
  -d '{"reason":"will handle manually"}'

# Force outcome evaluation while VERIFYING
curl -X POST http://localhost:3001/api/incidents/:id/evaluate-outcome
```

`POST /api/events` body examples:

```json
{ "type": "order", "payload": { "orderId": "o1", "amount": 420 } }
```

```json
{
  "events": [
    { "type": "prep_complete", "payload": { "orderId": "o1", "prepMinutes": 24 } },
    { "type": "cancellation", "payload": { "orderId": "o1", "reason": "wait" } }
  ]
}
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | API server with hot reload |
| `npm run dev:worker` | Detection + investigation + outcome loops |
| `npm run replay:overload` | Seed overload burst + detect once |
| `npm run replay:fresh` | Resolve open incidents, wipe store data, then detect |
| `npm run replay:reset` | Resolve open incidents |
| `npm run replay:reset:wipe` | Resolve + delete store events/metrics |
| `npm run smoke:investigate` | Fresh overload + Gemini investigation E2E |
| `npm run smoke:approve` | Approve + outcome E2E (optional `--reuse`) |
| `npm run db:migrate` | Apply Postgres schema |
| `npm run build` | Compile to `dist/` (+ copy schema.sql) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/
  index.ts              HTTP entry
  worker.ts             Detection + investigation + outcome
  app.ts                Express app
  config/env.ts
  types/
  db/                   pool, schema, migrate
  redis/
  llm/                  Gemini
  routes/               health, events, incidents
  services/             events, metrics, detection, approval, actions, outcomes, executeAction
  loops/                detection, investigation, investigationLoop, outcome
  tools/                7 investigation tools
```
