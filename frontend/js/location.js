import { apiGet, apiPost } from "./api.js";

const state = {
  locations: [],
  storeId: null,
  analytics: null,
  compare: null,
  posChart: null,
  reviewChart: null,
  seeding: false,
};

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function pct(n) {
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function seededOnly() {
  return state.locations.filter((l) => l.seeded);
}

function fillSelect(el, list, selectedId) {
  if (!el) return;
  el.innerHTML = list
    .map(
      (l) =>
        `<option value="${l.storeId}" ${
          l.storeId === selectedId ? "selected" : ""
        }>${l.name}${l.seeded ? "" : " (demo)"}</option>`,
    )
    .join("");
}

function renderChips() {
  const el = document.getElementById("outlet-chips");
  if (!el) return;
  el.innerHTML = state.locations
    .map((l) => {
      const active = l.storeId === state.storeId ? "active" : "";
      const badge = l.seeded ? "Live seed" : "Demo";
      return `<button type="button" class="outlet-chip ${active}" data-store="${l.storeId}">
        <span class="outlet-chip-name">${l.icon || ""} ${l.name}</span>
        <span class="outlet-chip-meta">★ ${Number(l.rating).toFixed(1)} · ${badge}</span>
      </button>`;
    })
    .join("");
}

function destroyChart(key) {
  if (state[key]) {
    state[key].destroy();
    state[key] = null;
  }
}

function renderPosChart(activity) {
  const canvas = document.getElementById("pos-chart");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("posChart");

  const labels = (activity || []).map((p) => p.date.slice(5));
  state.posChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Orders",
          data: (activity || []).map((p) => p.orders),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.15)",
          tension: 0.35,
          fill: true,
        },
        {
          label: "Cancels",
          data: (activity || []).map((p) => p.cancellations),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.12)",
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.04)" } },
      },
    },
  });
}

function renderReviewChart(daily) {
  const canvas = document.getElementById("review-chart");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("reviewChart");

  state.reviewChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: (daily || []).map((p) => p.date.slice(5)),
      datasets: [
        {
          label: "Avg ★",
          data: (daily || []).map((p) => p.avgRating || 0),
          backgroundColor: "rgba(245,158,11,0.55)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { display: false } },
        y: {
          min: 0,
          max: 5,
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

function renderInventory(items, stockouts) {
  const el = document.getElementById("inventory-bars");
  if (!el) return;
  if (!items?.length) {
    el.innerHTML =
      '<div class="empty">No inventory snapshots yet — run <code>npm run seed:portfolio</code></div>';
    return;
  }
  const max = Math.max(...items.map((i) => i.onHand), 1);
  el.innerHTML = items
    .map((i) => {
      const pctW = Math.round((i.onHand / max) * 100);
      const bad = i.onHand <= 0 || i.status === "stockout";
      const low = !bad && (i.onHand < 15 || i.status === "low");
      return `<div class="inv-row">
        <div class="inv-label">${i.name || i.sku}</div>
        <div class="inv-track"><div class="inv-fill ${bad ? "bad" : low ? "low" : "ok"}" style="width:${pctW}%"></div></div>
        <div class="inv-qty">${i.onHand}</div>
      </div>`;
    })
    .join("");

  if (stockouts?.length) {
    el.innerHTML += `<div class="inv-stockout-note">${stockouts.length} stockout(s): ${stockouts
      .map((s) => s.name || s.sku)
      .join(", ")}</div>`;
  }
}

function renderReviews(reviews) {
  const el = document.getElementById("review-list");
  if (!el) return;
  const list = reviews?.recent || [];
  if (!list.length) {
    el.innerHTML = '<div class="empty">No reviews in window</div>';
    return;
  }
  el.innerHTML = list
    .map(
      (r) => `<article class="review-item">
      <div class="review-stars">${"★".repeat(Math.round(r.rating))}${"☆".repeat(
        Math.max(0, 5 - Math.round(r.rating)),
      )}</div>
      <div class="review-text">${r.text}</div>
      <div class="review-meta">${r.channel || "review"} · ${new Date(
        r.at,
      ).toLocaleString()}</div>
    </article>`,
    )
    .join("");
}

function renderAnalytics(data) {
  state.analytics = data;
  const m = data.metrics?.["15m"] || {};
  const reviews = data.reviews || {};

  setText("kpi-velocity", Number(m.order_velocity || 0).toFixed(2));
  setText("kpi-prep", `${Number(m.prep_time || 0).toFixed(1)}m`);
  setText("kpi-cancel", pct(m.cancellation_rate || 0));
  setText(
    "kpi-rating",
    reviews.count ? Number(reviews.avgRating).toFixed(2) : "—",
  );
  setText(
    "kpi-rating-hint",
    reviews.count
      ? `${reviews.count} reviews · ${(Number(reviews.lowStarPct || 0) * 100).toFixed(0)}% ≤2★`
      : data.seeded
        ? "No reviews yet"
        : "Demo outlet — seed for live charts",
  );
  setText("review-count-label", `${reviews.count || 0} reviews`);
  setText(
    "page-sub",
    `${data.store?.name || "Outlet"} · ${data.store?.area || ""} · ${
      data.seeded ? "seeded analytics" : "demo profile"
    }`,
  );

  const staff = data.staffing || {};
  const staffEl = document.getElementById("staffing-box");
  if (staffEl) {
    if (staff.cooksOnFloor == null) {
      staffEl.textContent = "No staffing snapshot";
    } else {
      const ok = (staff.cooksOnFloor ?? 0) >= (staff.cooksRequired ?? 0);
      staffEl.innerHTML = `<span class="${ok ? "ok" : "bad"}">${staff.cooksOnFloor} / ${
        staff.cooksRequired ?? "?"
      } cooks</span> · ${staff.status || "—"}`;
    }
  }

  renderPosChart(data.activity);
  renderReviewChart(reviews.daily);
  renderInventory(data.inventory, data.stockouts);
  renderReviews(reviews);
}

function renderCompare(cmp) {
  state.compare = cmp;
  const scores = document.getElementById("compare-scores");
  const narrative = document.getElementById("compare-narrative");
  const reasons = document.getElementById("compare-reasons");
  if (!scores || !narrative || !reasons) return;

  const winA = cmp.winner === cmp.a.storeId;
  const winB = cmp.winner === cmp.b.storeId;

  scores.innerHTML = `
    <div class="compare-score-card ${winA ? "winner" : ""}">
      <div class="compare-score-name">${cmp.a.name}</div>
      <div class="compare-score-value">${cmp.scoreA}</div>
      <div class="compare-score-sub">★ ${Number(cmp.a.rating).toFixed(1)} · cancel ${pct(
        cmp.a.cancelRate,
      )}</div>
    </div>
    <div class="compare-vs">vs</div>
    <div class="compare-score-card ${winB ? "winner" : ""}">
      <div class="compare-score-name">${cmp.b.name}</div>
      <div class="compare-score-value">${cmp.scoreB}</div>
      <div class="compare-score-sub">★ ${Number(cmp.b.rating).toFixed(1)} · cancel ${pct(
        cmp.b.cancelRate,
      )}</div>
    </div>`;

  narrative.textContent = cmp.narrative || "No narrative.";

  reasons.innerHTML = (cmp.reasons || [])
    .map((r) => {
      const favors =
        r.favors === "a" ? cmp.a.name : r.favors === "b" ? cmp.b.name : "Tie";
      return `<div class="compare-reason impact-${r.impact}">
        <div class="compare-reason-top">
          <span class="compare-metric">${r.metric}</span>
          <span class="compare-favors">${favors}</span>
        </div>
        <div class="compare-reason-note">${r.note}</div>
        <div class="compare-reason-vals">${cmp.a.name}: ${formatReasonVal(
          r.metric,
          r.a,
        )} · ${cmp.b.name}: ${formatReasonVal(r.metric, r.b)}</div>
      </div>`;
    })
    .join("");
}

function formatReasonVal(metric, v) {
  if (metric === "cancel_rate") return pct(v);
  if (metric === "prep_time") return `${Number(v).toFixed(1)}m`;
  if (metric === "review_avg") return Number(v).toFixed(2);
  if (metric === "order_velocity") return Number(v).toFixed(2);
  return String(v);
}

async function loadOutlet(storeId) {
  state.storeId = storeId;
  const select = document.getElementById("outlet-select");
  if (select) select.value = storeId;
  renderChips();
  history.replaceState(null, "", `location.html?storeId=${encodeURIComponent(storeId)}`);

  const data = await apiGet(
    `/api/locations/${encodeURIComponent(storeId)}?days=7`,
  );
  renderAnalytics(data);
}

async function runCompare() {
  const a = document.getElementById("compare-a")?.value;
  const b = document.getElementById("compare-b")?.value;
  if (!a || !b) return;
  if (a === b) {
    setText("compare-narrative", "Pick two different outlets.");
    return;
  }
  setText("compare-narrative", "Comparing…");
  const cmp = await apiGet(
    `/api/locations/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(
      b,
    )}&narrative=0`,
  );
  renderCompare(cmp);
}

async function runSeed() {
  if (state.seeding) return;
  const keepPrimary = Boolean(
    document.getElementById("seed-keep-primary")?.checked,
  );
  const status = document.getElementById("seed-status");
  const buttons = [
    document.getElementById("btn-seed"),
    document.getElementById("btn-seed-main"),
  ].filter(Boolean);

  state.seeding = true;
  for (const b of buttons) {
    b.setAttribute("disabled", "true");
    b.textContent = "Seeding…";
  }
  if (status) {
    status.textContent = keepPrimary
      ? "Seeding Jayanagar + Indiranagar (keeping Koramangala)…"
      : "Seeding Koramangala + Jayanagar + Indiranagar — ~20–40s…";
    status.classList.remove("ok", "bad");
  }

  try {
    const result = await apiPost("/api/locations/seed", { keepPrimary, days: 7 });
    if (status) {
      status.textContent = `${result.message} Inserted ${result.eventsInserted} events.`;
      status.classList.add("ok");
    }
    await boot();
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = `Seed failed: ${err instanceof Error ? err.message : String(err)}`;
      status.classList.add("bad");
    }
  } finally {
    state.seeding = false;
    for (const b of buttons) {
      b.removeAttribute("disabled");
    }
    const top = document.getElementById("btn-seed");
    const main = document.getElementById("btn-seed-main");
    if (top) top.textContent = "Seed portfolio";
    if (main) main.textContent = "Seed portfolio data";
  }
}

async function boot() {
  const list = await apiGet("/api/locations");
  state.locations = list.locations || [];

  const preferred =
    qs("storeId") ||
    seededOnly()[0]?.storeId ||
    state.locations[0]?.storeId;

  fillSelect(document.getElementById("outlet-select"), state.locations, preferred);

  const seeded = seededOnly();
  const defaultA =
    seeded.find((l) => l.name === "Jayanagar")?.storeId || seeded[0]?.storeId;
  const defaultB =
    seeded.find((l) => l.name === "Koramangala")?.storeId ||
    seeded[1]?.storeId ||
    preferred;

  fillSelect(document.getElementById("compare-a"), seeded, defaultA);
  fillSelect(document.getElementById("compare-b"), seeded, defaultB);

  renderChips();
  if (preferred) await loadOutlet(preferred);
  await runCompare();
}

document.getElementById("outlet-select")?.addEventListener("change", (e) => {
  loadOutlet(e.target.value).catch(console.error);
});

document.getElementById("outlet-chips")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-store]");
  if (!btn) return;
  loadOutlet(btn.getAttribute("data-store")).catch(console.error);
});

document.getElementById("btn-refresh")?.addEventListener("click", () => {
  boot().catch(console.error);
});

document.getElementById("btn-compare")?.addEventListener("click", () => {
  runCompare().catch(console.error);
});

document.getElementById("btn-seed")?.addEventListener("click", () => {
  runSeed().catch(console.error);
});

document.getElementById("btn-seed-main")?.addEventListener("click", () => {
  runSeed().catch(console.error);
});

boot().catch((err) => {
  console.error(err);
  setText("page-sub", "Failed to load locations — is the API running?");
});
