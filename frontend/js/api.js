/** Shared API helpers — LOSSLine Express backend (:3001) */

const isFile = window.location.protocol === "file:";
export const API_ORIGIN = isFile
  ? "http://127.0.0.1:3001"
  : window.location.origin;

export async function apiGet(path) {
  const res = await fetch(`${API_ORIGIN}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export async function apiPost(path, body = {}) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err.error) msg = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function money(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN")}`;
}

export function statusBadge(status) {
  const key = String(status || "").toLowerCase();
  return `<span class="badge badge-${key}">${String(status || "").replaceAll("_", " ")}</span>`;
}

export function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export const PIPELINE = [
  "DETECTED",
  "INVESTIGATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
  "RESOLVED",
];

export function pipelineIndex(status) {
  if (status === "NOT_IMPROVED") return PIPELINE.length - 1;
  const i = PIPELINE.indexOf(status);
  return i >= 0 ? i : 0;
}

/** Pull tool names from an agent_runs.messages blob. */
export function extractTools(messagesBlob) {
  const tools = [];
  const root = messagesBlob?.toolCalls || messagesBlob?.messages || messagesBlob;
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node.toolCalls)) {
      for (const t of node.toolCalls) {
        if (t?.name) tools.push(t.name);
      }
    }
    if (node.name && (node.args || node.arguments || node.input)) {
      tools.push(node.name);
    }
    if (Array.isArray(node.messages)) walk(node.messages);
    if (node.content && Array.isArray(node.content)) walk(node.content);
  };
  walk(root);
  return [...new Set(tools)];
}
