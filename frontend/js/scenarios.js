import { apiGet, apiPost } from "./api.js";

const state = {
  scenarios: [],
  lastScenarioRun: null,
  kitchen: null,
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
    kitchen.staffingStatus === "shortfall"
      ? "bad"
      : kitchen.cooksOnFloor != null
        ? "ok"
        : "";
  const oversell = kitchen.deliveryOversell?.length
    ? kitchen.deliveryOversell
        .map((d) => `${d.channel} +${d.oversellBy}`)
        .join(", ")
    : "None";
  const oversellClass = kitchen.deliveryOversell?.length ? "warn" : "ok";
  const root = kitchen.inferredRootCause || "—";
  const rootClass =
    root === "none"
      ? "ok"
      : root.includes("shortage") ||
          root.includes("shortfall") ||
          root.includes("oversell")
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
    setText(
      "page-sub",
      `Meghana Biryani · ${data.outlet || "Koramangala"} · G1–G6 live runner`,
    );
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
log("Meghana scenarios page ready · play G1–G6 here");
