import {
  apiGet,
  apiPost,
  money,
  statusBadge,
  fmtTime,
} from "./api.js";

const state = {
  summary: null,
  metrics: null,
  incidents: [],
  activity: null,
  branches: null,
  scenarios: [],
  lastScenarioRun: null,
  kitchen: null,
  details: new Map(),
  chart: null,
  map: null,
  markers: [],
  selectedBranchId: null,
  copilotHistory: [],
};

function log(msg, kind = "") {
  const el = document.getElementById("console-log");
  if (!el) return;
  const line = document.createElement("div");
  line.className = `log-line ${kind}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setConn(ok) {
  const pill = document.getElementById("conn-pill");
  if (!pill) return;
  pill.classList.toggle("offline", !ok);
  pill.innerHTML = ok
    ? `<span class="dot"></span> Connected`
    : `<span class="dot"></span> Offline`;
}

function buildCopilotContext() {
  return {
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    summary: state.summary,
    metrics15m: state.metrics?.windows?.["15m"] ?? null,
    estimatedExposure: state.summary?.estimatedExposure ?? 0,
    activeCount: state.summary?.activeCount ?? 0,
    activity: state.activity?.series ?? [],
    kitchen: state.kitchen,
    lastScenario: state.lastScenarioRun
      ? {
          id: state.lastScenarioRun.scenario?.id,
          name: state.lastScenarioRun.scenario?.name,
          proves: state.lastScenarioRun.scenario?.proves,
          verdict: state.lastScenarioRun.verdict,
          rootCause: state.lastScenarioRun.kitchen?.inferredRootCause,
        }
      : null,
    branches: (state.branches?.branches || []).map((b) => ({
      id: b.id,
      name: b.name,
      risk: b.risk,
      revDelta: b.revDelta,
      activeIncidents: b.activeIncidents,
      estimatedExposure: b.estimatedExposure,
      demo: b.demo,
    })),
    topIncidents: state.incidents.slice(0, 6).map((i) => ({
      id: i.id,
      storeId: i.storeId,
      status: i.status,
      type: i.type,
      reasons: i.baseline?.reasons ?? [],
      scenarioId: i.baseline?.scenarioId ?? null,
      kitchenRootCause: i.baseline?.kitchenRootCause ?? null,
    })),
  };
}

async function loadDetail(id) {
  if (state.details.has(id)) return state.details.get(id);
  const detail = await apiGet(`/api/incidents/${id}`);
  state.details.set(id, detail);
  return detail;
}

async function refresh() {
  try {
    const [summary, metrics, list, activity, branches, kitchen] = await Promise.all([
      apiGet("/api/summary"),
      apiGet("/api/metrics"),
      apiGet("/api/incidents?limit=50"),
      apiGet("/api/activity?days=7"),
      apiGet("/api/branches"),
      apiGet("/api/scenarios/kitchen"),
    ]);
    state.summary = summary;
    state.metrics = metrics;
    state.incidents = list.incidents || [];
    state.activity = activity;
    state.branches = branches;
    state.kitchen = kitchen.kitchen;
    state.details.clear();

    renderKpis();
    renderMetrics();
    renderChart();
    renderAlerts();
    renderBranches();
    await renderIncidents();

    const month = new Date().toLocaleString("en-US", {
      month: "short",
      year: "numeric",
    });
    const outlets = branches?.branches?.length ?? 0;
    const root = kitchen?.kitchen?.inferredRootCause;
    setText(
      "page-sub",
      `Meghana Biryani · Koramangala · ${month} · ${outlets} outlets · kitchen=${root || "—"} · ${new Date().toLocaleTimeString()}`,
    );
    setText("badge-branches", String(summary.branchesAtRisk ?? summary.activeCount ?? 0));
    setConn(true);
  } catch (err) {
    setConn(false);
    log(`Refresh failed: ${err.message}`, "err");
  }
}

function renderKpis() {
  const s = state.summary;
  if (!s) return;
  setText("kpi-total", String(s.incidentCount));
  setText("kpi-active", String(s.activeCount));
  setText("kpi-resolved", String(s.resolvedCount));
  setText("kpi-exposure", money(s.estimatedExposure));
  setText(
    "kpi-total-hint",
    s.awaitingApproval
      ? `${s.awaitingApproval} awaiting approval`
      : "All tracked incidents",
  );
  setText(
    "kpi-active-hint",
    s.activeCount ? "Needs attention" : "No open overload",
  );
  setText("kpi-resolved-hint", "Closed after verification");
  setText(
    "kpi-exposure-hint",
    s.estimatedExposure > 0 ? "From open recommendations" : "No open exposure",
  );
}

function renderMetrics() {
  const box = document.getElementById("metrics-box");
  if (!box || !state.metrics) return;
  const m = state.metrics.windows["15m"];
  const t = state.metrics.thresholds;
  const rows = [
    ["Order velocity / min", m.order_velocity.toFixed(3), `spike thr ≥ ${t.orderVelocitySpike}x`],
    ["Prep time (min)", m.prep_time.toFixed(1), `thr ≥ ${t.prepTimeMinutes}m`],
    ["Cancel rate", `${(m.cancellation_rate * 100).toFixed(1)}%`, `thr ≥ ${(t.cancelRate * 100).toFixed(0)}%`],
    ["Handoff delay (min)", m.handoff_delay.toFixed(1), `thr ≥ ${t.handoffDelayMinutes}m`],
    ["Orders (15m)", String(m.order_count), `${m.cancellation_count} cancels`],
  ];
  box.innerHTML = rows
    .map(
      ([name, val, note]) => `
      <div class="metric-row">
        <span>${name}<br><small style="color:var(--dim)">${note}</small></span>
        <strong>${val}</strong>
      </div>`,
    )
    .join("");
}

function renderChart() {
  const canvas = document.getElementById("activity-chart");
  if (!canvas || !state.activity || typeof Chart === "undefined") return;

  const series = state.activity.series || [];
  const labels = series.map((p) => {
    const d = new Date(`${p.date}T12:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const orders = series.map((p) => p.orders);
  const cancels = series.map((p) => p.cancellations);
  const revenue = series.map((p) => Math.round(p.revenueEstimate));

  const data = {
    labels,
    datasets: [
      {
        type: "line",
        label: "Orders",
        data: orders,
        borderColor: "#60a5fa",
        backgroundColor: "rgba(96,165,250,0.18)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        yAxisID: "y",
      },
      {
        type: "bar",
        label: "Cancels",
        data: cancels,
        backgroundColor: "rgba(248,113,113,0.55)",
        borderRadius: 4,
        yAxisID: "y",
        order: 2,
      },
      {
        type: "line",
        label: "Revenue ₹",
        data: revenue,
        borderColor: "#34d399",
        backgroundColor: "transparent",
        tension: 0.35,
        pointRadius: 2,
        borderDash: [5, 4],
        yAxisID: "y1",
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#0b1220",
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        titleColor: "#f1f5f9",
        bodyColor: "#94a3b8",
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(255,255,255,0.04)" },
        ticks: { color: "#64748b", font: { size: 11 } },
      },
      y: {
        position: "left",
        beginAtZero: true,
        grid: { color: "rgba(255,255,255,0.06)" },
        ticks: { color: "#64748b", font: { size: 11 } },
      },
      y1: {
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: {
          color: "#64748b",
          font: { size: 11 },
          callback: (v) => `₹${v}`,
        },
      },
    },
  };

  if (state.chart) {
    state.chart.data = data;
    state.chart.options = options;
    state.chart.update("none");
    return;
  }

  state.chart = new Chart(canvas, { type: "line", data, options });
}

function openStatus(status) {
  return [
    "DETECTED",
    "INVESTIGATING",
    "AWAITING_APPROVAL",
    "APPROVED",
    "EXECUTING",
    "VERIFYING",
  ].includes(status);
}

async function renderAlerts() {
  const box = document.getElementById("alert-list");
  if (!box) return;

  const open = state.incidents.filter((i) => openStatus(i.status)).slice(0, 5);
  if (!open.length) {
    box.innerHTML = `
      <div class="empty-ok">
        <div class="check">✓</div>
        <div>No active alerts</div>
      </div>`;
    return;
  }

  const cards = await Promise.all(
    open.map(async (inc) => {
      let detail = null;
      try {
        detail = await loadDetail(inc.id);
      } catch {
        detail = null;
      }
      const rec = detail?.recommendation;
      const reasons = Array.isArray(inc.baseline?.reasons)
        ? inc.baseline.reasons.join("; ")
        : "";
      const severity =
        inc.status === "AWAITING_APPROVAL"
          ? "HIGH"
          : inc.status === "DETECTED"
            ? "CRITICAL"
            : "MEDIUM";

      return `
        <article class="alert-item">
          <div class="alert-top">
            <div class="alert-title">${inc.type.replaceAll("_", " ")} · ${inc.storeId}</div>
            <span class="risk-pill risk-${severity}">${severity}</span>
          </div>
          <div class="alert-meta">
            ${rec?.explanation || reasons || "Detected by threshold loop."}<br />
            ${statusBadge(inc.status)}
            ${rec ? ` · conf <strong>${rec.confidence}%</strong>` : ""}
            ${rec?.estimatedExposure != null ? ` · <strong>${money(rec.estimatedExposure)}</strong>` : ""}
            · ${fmtTime(inc.updatedAt)}
          </div>
        </article>`;
    }),
  );

  box.innerHTML = cards.join("");
}

function riskClass(risk) {
  return `risk-${risk || "LOW"}`;
}

function renderBranches() {
  const cards = document.getElementById("branch-cards");
  const list = state.branches?.branches || [];
  if (!cards) return;

  setText("branch-count", `${list.length} locations`);

  if (!list.length) {
    cards.innerHTML = '<div class="empty">No outlets yet</div>';
    return;
  }

  if (!state.selectedBranchId) state.selectedBranchId = list[0].id;

  cards.innerHTML = list
    .map((b) => {
      const deltaClass = b.revDelta < 0 ? "down" : "up";
      const delta =
        b.revDelta > 0 ? `+${b.revDelta}%` : `${b.revDelta}%`;
      return `
        <article class="branch-card ${b.id === state.selectedBranchId ? "active" : ""}" data-branch="${b.id}">
          <div class="branch-card-top">
            <div>
              <div class="branch-icon">${b.icon || "📍"}</div>
              <div class="branch-name">${b.name}</div>
              <div class="branch-area">${b.area}</div>
              ${b.demo === false ? '<div class="branch-live-tag">Live data</div>' : ""}
            </div>
            <span class="risk-pill ${riskClass(b.risk)}">${b.risk}</span>
          </div>
          <div class="branch-stats">
            <span>★ ${Number(b.rating).toFixed(1)}</span>
            <span class="${deltaClass}">Rev ${delta}</span>
          </div>
        </article>`;
    })
    .join("");

  renderMap(list);
}

function renderMap(list) {
  const el = document.getElementById("branch-map");
  if (!el || typeof L === "undefined") return;

  const center = state.branches?.mapCenter || { lat: 12.97, lng: 77.64 };

  if (!state.map) {
    state.map = L.map(el, {
      zoomControl: true,
      attributionControl: false,
    }).setView([center.lat, center.lng], 11);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 18,
    }).addTo(state.map);

    setTimeout(() => state.map?.invalidateSize(), 80);
  }

  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];

  for (const b of list) {
    const color =
      b.risk === "CRITICAL"
        ? "#ef4444"
        : b.risk === "HIGH"
          ? "#f59e0b"
          : b.risk === "MEDIUM"
            ? "#3b82f6"
            : "#10b981";

    const marker = L.circleMarker([b.lat, b.lng], {
      radius: b.id === state.selectedBranchId ? 11 : 8,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2,
    })
      .addTo(state.map)
      .bindPopup(
        `<strong>${b.name}</strong><br/>${b.risk} · Rev ${b.revDelta}%${
          b.demo === false ? "<br/><em>Live kitchen</em>" : ""
        }`,
      );

    marker.on("click", () => {
      state.selectedBranchId = b.id;
      renderBranches();
    });
    state.markers.push(marker);
  }
}

async function renderIncidents() {
  const box = document.getElementById("incident-list");
  if (!box) return;

  if (!state.incidents.length) {
    box.innerHTML =
      '<div class="empty">No incidents yet. Seed overload with Upload Data, then start the worker.</div>';
    return;
  }

  const cards = await Promise.all(
    state.incidents.slice(0, 8).map(async (inc) => {
      let detail = null;
      try {
        detail = await loadDetail(inc.id);
      } catch {
        detail = null;
      }
      const rec = detail?.recommendation;
      const outcome = detail?.outcome;
      const actionable = inc.status === "AWAITING_APPROVAL";
      const verifying = inc.status === "VERIFYING";
      const reasons = Array.isArray(inc.baseline?.reasons)
        ? inc.baseline.reasons.join("; ")
        : "";

      return `
        <article class="incident ${actionable ? "hot" : ""}">
          <div class="incident-top">
            <div class="incident-title">Operational overload · ${inc.storeId}</div>
            ${statusBadge(inc.status)}
          </div>
          <div class="incident-body">${rec?.explanation || reasons || "Detected by threshold loop."}</div>
          <div class="incident-meta">
            <div>Confidence<strong>${rec ? `${rec.confidence}%` : "—"}</strong></div>
            <div>Exposure<strong>${rec?.estimatedExposure != null ? money(rec.estimatedExposure) : "—"}</strong></div>
            <div>Updated<strong>${fmtTime(inc.updatedAt)}</strong></div>
          </div>
          ${
            rec
              ? `<div class="incident-body"><strong style="color:var(--text)">Recommend:</strong> ${rec.actionType}</div>`
              : ""
          }
          ${
            outcome
              ? `<div class="incident-body" style="margin-top:6px">Outcome: <strong style="color:var(--text)">${outcome.verdict}</strong></div>`
              : ""
          }
          <div class="incident-actions">
            <a class="btn" href="agent.html?id=${inc.id}">Agent loop →</a>
            ${
              actionable
                ? `<button class="btn btn-success" data-approve="${inc.id}">Approve</button>
                   <button class="btn btn-danger" data-reject="${inc.id}">Reject</button>`
                : ""
            }
            ${
              verifying
                ? `<button class="btn btn-primary" data-eval="${inc.id}">Force evaluate</button>`
                : ""
            }
            ${
              inc.status === "DETECTED"
                ? `<button class="btn" data-invest="${inc.id}">Investigate</button>`
                : ""
            }
          </div>
        </article>`;
    }),
  );

  box.innerHTML = cards.join("");
}

async function onClick(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  const branch = t.closest("[data-branch]");
  if (branch) {
    state.selectedBranchId = branch.getAttribute("data-branch");
    renderBranches();
    return;
  }

  const approve = t.getAttribute("data-approve");
  const reject = t.getAttribute("data-reject");
  const evalId = t.getAttribute("data-eval");
  const invest = t.getAttribute("data-invest");

  try {
    if (approve) {
      t.setAttribute("disabled", "true");
      log(`Approving ${approve}…`);
      const r = await apiPost(`/api/incidents/${approve}/approve`, {
        approvedBy: "ui_operator",
      });
      log(`Approved → ${r.status} (recovery events ${r.recoveryEvents})`, "ok");
      await refresh();
    }
    if (reject) {
      t.setAttribute("disabled", "true");
      log(`Rejecting ${reject}…`);
      const r = await apiPost(`/api/incidents/${reject}/reject`, {
        reason: "rejected_via_ui",
      });
      log(`Rejected → ${r.status}`, "warn");
      await refresh();
    }
    if (evalId) {
      t.setAttribute("disabled", "true");
      log(`Evaluating outcome ${evalId}…`);
      const r = await apiPost(`/api/incidents/${evalId}/evaluate-outcome`);
      log(`Outcome → ${r.status || r.tick?.status}`, "ok");
      await refresh();
    }
    if (invest) {
      t.setAttribute("disabled", "true");
      log(`Kicking investigation ${invest}…`);
      const r = await apiPost(`/api/incidents/${invest}/investigate`);
      log(`Investigation → ${r.status}`, "ok");
      await refresh();
    }
  } catch (err) {
    log(err.message, "err");
  }
}

async function seedDemo() {
  const btn = document.getElementById("btn-demo");
  if (btn) btn.disabled = true;
  log("Seeding overload burst via /api/events…");

  const now = Date.now();
  const ago = (m) => new Date(now - m * 60_000).toISOString();
  const events = [];

  for (let i = 0; i < 12; i += 1) {
    events.push({
      type: "order",
      payload: { orderId: `ui_${now}_${i}`, amount: 350 + i * 10 },
      occurredAt: ago(14 - i),
    });
  }
  for (let i = 0; i < 5; i += 1) {
    events.push({
      type: "prep_complete",
      payload: { orderId: `ui_${now}_${i}`, prepMinutes: 22 + i },
      occurredAt: ago(10 - i),
    });
  }
  for (let i = 0; i < 4; i += 1) {
    events.push({
      type: "handoff",
      payload: { orderId: `ui_${now}_${i}`, delayMinutes: 10 + i },
      occurredAt: ago(8 - i),
    });
  }
  for (const i of [1, 3, 5]) {
    events.push({
      type: "cancellation",
      payload: { orderId: `ui_${now}_${i}`, reason: "too_long_wait" },
      occurredAt: ago(6 - i * 0.2),
    });
  }

  try {
    const res = await apiPost("/api/events", { events });
    log(`Ingested ${res.count ?? events.length} events`, "ok");
    log("If worker is running, detection → investigation should follow.", "warn");
    await refresh();
  } catch (err) {
    log(err.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openCopilot() {
  const drawer = document.getElementById("copilot-drawer");
  if (!drawer) return;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  const msgs = document.getElementById("copilot-messages");
  if (msgs && !msgs.childElementCount) {
    appendCopilot(
      "assistant",
      "I can see your live KPIs, alerts, activity chart, and outlet map. Ask about revenue at risk, which branch is critical, or what to approve next.",
    );
  }
  document.getElementById("copilot-input")?.focus();
}

function closeCopilot() {
  const drawer = document.getElementById("copilot-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

function appendCopilot(role, content) {
  const box = document.getElementById("copilot-messages");
  if (!box) return;
  const bubble = document.createElement("div");
  bubble.className = `copilot-bubble ${role}`;
  bubble.textContent = content;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

async function askCopilot(message) {
  const text = String(message || "").trim();
  if (!text) return;

  appendCopilot("user", text);
  state.copilotHistory.push({ role: "user", content: text });

  const input = document.getElementById("copilot-input");
  if (input) input.value = "";

  const thinking = document.createElement("div");
  thinking.className = "copilot-bubble meta";
  thinking.textContent = "Thinking with dashboard context…";
  document.getElementById("copilot-messages")?.appendChild(thinking);

  try {
    const res = await apiPost("/api/copilot", {
      message: text,
      history: state.copilotHistory.slice(-10),
      context: buildCopilotContext(),
    });
    thinking.remove();
    appendCopilot("assistant", res.reply);
    state.copilotHistory.push({ role: "assistant", content: res.reply });
    if (res.provider === "fallback") {
      appendCopilot(
        "meta",
        "Answered with local context fallback (Gemini optional).",
      );
    }
  } catch (err) {
    thinking.remove();
    appendCopilot("assistant", `Copilot error: ${err.message}`);
  }
}

document.getElementById("main")?.addEventListener("click", onClick);
document.getElementById("btn-refresh")?.addEventListener("click", () => refresh());
document.getElementById("nav-seed")?.addEventListener("click", seedDemo);
document.getElementById("btn-copilot")?.addEventListener("click", openCopilot);
document.getElementById("nav-copilot")?.addEventListener("click", openCopilot);
document.getElementById("copilot-close")?.addEventListener("click", closeCopilot);
document.getElementById("copilot-drawer")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeCopilot();
});
document.getElementById("copilot-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  askCopilot(document.getElementById("copilot-input")?.value);
});
document.querySelectorAll(".copilot-chips [data-prompt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    openCopilot();
    askCopilot(btn.getAttribute("data-prompt"));
  });
});

function setScenarioPill(text, kind = "") {
  const el = document.getElementById("scenario-live-pill");
  if (!el) return;
  el.textContent = text;
  el.className = `scenario-live ${kind}`.trim();
}

function renderScenarioCards() {
  const grid = document.getElementById("scenario-grid");
  if (!grid) return;
  const activeId = state.lastScenarioRun?.scenario?.id;

  grid.innerHTML = state.scenarios
    .map((s) => {
      const expectClass = s.expectIncident ? "fire" : "quiet";
      const expectLabel = s.expectIncident ? "Expect alert" : "Must stay quiet";
      return `
        <article class="scenario-card ${s.id === activeId ? "active" : ""}" data-scenario-card="${s.id}">
          <div class="scenario-card-top">
            <span class="scenario-id">${s.id}</span>
            <span class="scenario-expect ${expectClass}">${expectLabel}</span>
          </div>
          <div class="scenario-name">${s.name}</div>
          <div class="scenario-proves">Proves: <strong>${s.proves}</strong></div>
          <button class="btn btn-primary" data-run-scenario="${s.id}">Play live</button>
        </article>`;
    })
    .join("");
}

function renderScenarioStage(result) {
  const stage = document.getElementById("scenario-stage");
  if (!stage || !result?.scenario) return;
  stage.hidden = false;

  const s = result.scenario;
  const kitchen = result.kitchen || {};
  setText("stage-id", `${s.id} · ${s.proves}`);
  setText("stage-title", s.name);
  setText("stage-verdict", String(result.verdict || "—").replaceAll("_", " "));
  setText("stage-story", s.story);

  const beats = document.getElementById("stage-beats");
  if (beats) {
    beats.innerHTML = (s.liveBeats || [])
      .map((b, i) => `<span class="beat" data-beat="${i}">${b}</span>`)
      .join("");
    [...beats.querySelectorAll(".beat")].forEach((el, i) => {
      setTimeout(() => el.classList.add("on"), 350 * (i + 1));
    });
  }

  const stock =
    kitchen.stockouts?.length > 0
      ? kitchen.stockouts.map((x) => x.name || x.sku).join(", ")
      : kitchen.inventory?.length
        ? "Healthy"
        : "—";
  const stockClass =
    kitchen.stockouts?.length > 0
      ? "bad"
      : kitchen.inventory?.length
        ? "ok"
        : "";
  const staff =
    kitchen.cooksOnFloor != null
      ? `${kitchen.cooksOnFloor}/${kitchen.cooksRequired ?? "?"} cooks`
      : "—";
  const staffClass =
    kitchen.staffingStatus === "shortfall" ? "bad" : kitchen.cooksOnFloor != null ? "ok" : "";
  const oversell = kitchen.deliveryOversell?.length
    ? kitchen.deliveryOversell.map((d) => `${d.channel} +${d.oversellBy}`).join(", ")
    : "None";
  const oversellClass = kitchen.deliveryOversell?.length ? "warn" : "ok";
  const root = kitchen.inferredRootCause || "—";
  const rootClass =
    root === "none" ? "ok" : root.includes("shortage") || root.includes("shortfall") || root.includes("oversell")
      ? "warn"
      : "";

  const strip = document.getElementById("kitchen-strip");
  if (strip) {
    strip.innerHTML = `
      <div class="kitchen-chip"><div class="k-label">Inventory</div><div class="k-value ${stockClass}">${stock}</div></div>
      <div class="kitchen-chip"><div class="k-label">Staffing</div><div class="k-value ${staffClass}">${staff}</div></div>
      <div class="kitchen-chip"><div class="k-label">Delivery oversell</div><div class="k-value ${oversellClass}">${oversell}</div></div>
      <div class="kitchen-chip"><div class="k-label">Inferred root cause</div><div class="k-value ${rootClass}">${root.replaceAll("_", " ")}</div></div>
    `;
  }
}

async function loadScenarios() {
  try {
    const data = await apiGet("/api/scenarios");
    state.scenarios = data.scenarios || [];
    renderScenarioCards();
  } catch (err) {
    log(`Scenarios load failed: ${err.message}`, "err");
    const grid = document.getElementById("scenario-grid");
    if (grid) grid.innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

async function runScenario(id) {
  setScenarioPill(`Running ${id}…`, "running");
  log(`Playing Meghana scenario ${id}…`, "warn");
  try {
    const result = await apiPost("/api/scenarios/run", {
      id,
      wipe: true,
      detect: true,
    });
    state.lastScenarioRun = result;
    state.kitchen = result.kitchen;
    renderScenarioCards();
    renderScenarioStage(result);

    const ok =
      result.verdict === "QUIET_as_expected" ||
      result.verdict === "DETECTED_as_expected";
    setScenarioPill(
      ok ? `${id} ✓ ${result.verdict}` : `${id} ! ${result.verdict}`,
      ok ? "ok" : "bad",
    );
    log(
      `${id} → ${result.verdict} · events ${result.eventsIngested} · root ${result.kitchen?.inferredRootCause}${
        result.incident ? ` · incident ${result.incident.id}` : ""
      }`,
      ok ? "ok" : "warn",
    );
    await refresh();
  } catch (err) {
    setScenarioPill(`${id} failed`, "bad");
    log(`Scenario ${id} failed: ${err.message}`, "err");
  }
}

document.getElementById("scenario-grid")?.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const id = t.getAttribute("data-run-scenario");
  if (id) runScenario(id);
});

loadScenarios();
refresh();
setInterval(refresh, 5000);
log("Dashboard ready · Meghana G1–G6 live scenarios wired");
