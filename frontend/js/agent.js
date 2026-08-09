import {
  apiGet,
  PIPELINE,
  pipelineIndex,
  statusBadge,
  extractTools,
  money,
  fmtTime,
} from "./api.js";

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function renderPipeline(status) {
  const idx = pipelineIndex(status);
  const terminalBad = status === "NOT_IMPROVED";
  const nodes = PIPELINE.map((s, i) => {
    let cls = "pipe-node";
    if (terminalBad && s === "RESOLVED") {
      cls += i < idx ? " done" : "";
    } else if (i < idx) cls += " done";
    else if (i === idx) cls += " current";
    if (terminalBad && s === "RESOLVED" && status === "NOT_IMPROVED") {
      /* show NOT_IMPROVED as current on last node label */
    }
    const label =
      terminalBad && s === "RESOLVED" && i === PIPELINE.length - 1
        ? "NOT_IMPROVED"
        : s.replaceAll("_", " ");
    return `<div class="${cls}">${label}</div>`;
  });

  const withArrows = [];
  nodes.forEach((n, i) => {
    withArrows.push(n);
    if (i < nodes.length - 1) withArrows.push('<span class="pipe-arrow">→</span>');
  });
  setHtml("pipeline", withArrows.join(""));
}

function renderSteps(detail) {
  const box = document.getElementById("step-graph");
  if (!box) return;

  const runs = detail.agentRuns || [];
  if (!runs.length) {
    box.innerHTML =
      '<div class="empty">No agent_runs yet. Wait for investigation or click Investigate on the dashboard.</div>';
    return;
  }

  const cards = runs.map((run) => {
    const tools = extractTools(run.messages);
    const isFinal = tools.length === 0;
    const cls = isFinal ? "step-card final" : "step-card tool";
    const title = isFinal
      ? "Final recommendation"
      : `Tool calls · step ${run.step}`;
    const chips = tools.length
      ? tools.map((t) => `<span class="tool-chip">${t}</span>`).join("")
      : `<span class="tool-chip">no tools · model concluded</span>`;

    let preview = "";
    try {
      const blob = run.messages;
      const text =
        blob?.text ||
        (Array.isArray(blob?.messages)
          ? blob.messages.filter((m) => m.role === "model").at(-1)?.content
          : "") ||
        "";
      if (typeof text === "string" && text.trim()) {
        preview = text.trim().slice(0, 280) + (text.length > 280 ? "…" : "");
      }
    } catch {
      /* ignore */
    }

    return `
      <article class="${cls}">
        <div class="step-kicker">Agent step ${run.step} · ${fmtTime(run.createdAt)}</div>
        <div class="step-title">${title}</div>
        <div>${chips}</div>
        ${preview ? `<div class="step-body" style="margin-top:8px">${escapeHtml(preview)}</div>` : ""}
      </article>`;
  });

  // Decision / outcome nodes continue the graph after agent steps
  const rec = detail.recommendation;
  if (rec) {
    cards.push(`
      <article class="step-card final">
        <div class="step-kicker">Decision point</div>
        <div class="step-title">${rec.actionType} · ${rec.confidence}% confidence</div>
        <div class="step-body">${escapeHtml(rec.explanation || "")}</div>
        <div class="step-body" style="margin-top:6px">Exposure: <strong style="color:var(--text)">${rec.estimatedExposure != null ? money(rec.estimatedExposure) : "—"}</strong>/hr</div>
      </article>`);
  }

  if (detail.action) {
    const rejected = detail.action.params?.rejected;
    cards.push(`
      <article class="step-card ${rejected ? "tool" : "final"}">
        <div class="step-kicker">${rejected ? "Rejected" : "Action executed"}</div>
        <div class="step-title">${rejected ? "Operator rejected recommendation" : "Simulated execute_action"}</div>
        <div class="step-body">
          By: ${detail.action.approvedBy || "—"} ·
          Approved: ${fmtTime(detail.action.approvedAt)} ·
          Executed: ${fmtTime(detail.action.executedAt)}
        </div>
      </article>`);
  }

  if (detail.outcome) {
    cards.push(`
      <article class="step-card final">
        <div class="step-kicker">Outcome</div>
        <div class="step-title">${detail.outcome.verdict}</div>
        <div class="step-body">${escapeHtml(
          (detail.outcome.after?.improvements || []).join("; ") ||
            (detail.outcome.after?.regressions || []).join("; ") ||
            "Compared before/after metrics",
        )}</div>
      </article>`);
  }

  box.innerHTML = cards.join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderHeader(detail) {
  setHtml(
    "incident-header",
    `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div class="page-title" style="font-size:20px">Agent loop · ${detail.storeId}</div>
        <div class="page-sub">${detail.id} · ${detail.type} · ${statusBadge(detail.status)}</div>
      </div>
      <div class="actions">
        <a class="btn" href="index.html">← Dashboard</a>
        <button class="btn btn-primary" id="btn-reload">Refresh</button>
      </div>
    </div>`,
  );
  document.getElementById("btn-reload")?.addEventListener("click", () => load());
}

async function fillSelector(selectedId) {
  const sel = document.getElementById("incident-select");
  if (!sel) return;
  const list = await apiGet("/api/incidents?limit=50");
  const items = list.incidents || [];
  sel.innerHTML = items
    .map(
      (i) =>
        `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${i.status} · ${i.id.slice(0, 8)}…</option>`,
    )
    .join("");
  if (!items.length) {
    sel.innerHTML = `<option value="">No incidents</option>`;
  }
  sel.onchange = () => {
    const id = sel.value;
    if (id) window.location.search = `?id=${id}`;
  };
}

async function load() {
  let id = qs("id");
  try {
    if (!id) {
      const list = await apiGet("/api/incidents?limit=1");
      id = list.incidents?.[0]?.id;
    }
    if (!id) {
      setHtml(
        "incident-header",
        `<div class="page-title">Agent loop</div><div class="page-sub">No incidents yet — seed from the dashboard.</div>`,
      );
      setHtml("pipeline", "");
      setHtml(
        "step-graph",
        `<div class="empty"><a href="index.html">Go to dashboard</a> and run a demo.</div>`,
      );
      return;
    }

    await fillSelector(id);
    const detail = await apiGet(`/api/incidents/${id}`);
    renderHeader(detail);
    renderPipeline(detail.status);
    renderSteps(detail);

    const side = document.getElementById("side-panel");
    if (side) {
      const b = detail.baseline?.metrics_15m || {};
      side.innerHTML = `
        <div class="section-title">Baseline at detection</div>
        <div class="metric-row"><span>Prep</span><strong>${Number(b.prep_time || 0).toFixed(1)}m</strong></div>
        <div class="metric-row"><span>Cancel rate</span><strong>${((b.cancellation_rate || 0) * 100).toFixed(1)}%</strong></div>
        <div class="metric-row"><span>Handoff</span><strong>${Number(b.handoff_delay || 0).toFixed(1)}m</strong></div>
        <div class="metric-row"><span>Velocity</span><strong>${Number(b.order_velocity || 0).toFixed(3)}/min</strong></div>
        <div class="section-title" style="margin-top:14px">Reasons</div>
        <div class="step-body">${(detail.baseline?.reasons || []).map(escapeHtml).join("<br>") || "—"}</div>
      `;
    }
  } catch (err) {
    setHtml(
      "step-graph",
      `<div class="empty" style="color:var(--danger)">${escapeHtml(err.message)}</div>`,
    );
  }
}

load();
setInterval(load, 4000);
