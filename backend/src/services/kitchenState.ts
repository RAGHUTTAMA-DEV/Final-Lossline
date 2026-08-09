import type { StoreEvent } from "../types/index.js";

export interface InventoryItemState {
  sku: string;
  name?: string;
  onHand: number;
  status: string;
}

export interface KitchenState {
  inventory: InventoryItemState[];
  stockouts: InventoryItemState[];
  cooksOnFloor: number | null;
  cooksRequired: number | null;
  staffingStatus: string | null;
  replenishments: Array<{ sku: string; qtyAdded: number; at: string; source?: string }>;
  deliveryOversell: Array<{
    channel: string;
    accepted: number;
    kitchenSlotCap: number;
    oversellBy: number;
  }>;
  scenarioId: string | null;
  inferredRootCause:
    | "none"
    | "capacity_pressure"
    | "inventory_shortage"
    | "inventory_shortage_recovering"
    | "staffing_shortfall"
    | "delivery_oversell"
    | "operational_overload";
  notes: string[];
}

function latestByType(events: StoreEvent[], type: string): StoreEvent | undefined {
  const matched = events.filter((e) => e.type === type);
  return matched.length ? matched[matched.length - 1] : undefined;
}

/** Derive Meghana kitchen truth from recent typed events (deterministic). */
export function deriveKitchenState(events: StoreEvent[]): KitchenState {
  const notes: string[] = [];
  const scenarioId =
    events
      .map((e) => (typeof e.payload.scenarioId === "string" ? e.payload.scenarioId : null))
      .filter(Boolean)
      .at(-1) ?? null;

  const invEvent = latestByType(events, "inventory_snapshot");
  const rawItems = Array.isArray(invEvent?.payload.items)
    ? (invEvent!.payload.items as InventoryItemState[])
    : [];
  const inventory = rawItems.map((i) => ({
    sku: String(i.sku),
    name: i.name ? String(i.name) : undefined,
    onHand: Number(i.onHand) || 0,
    status: String(i.status || (Number(i.onHand) <= 0 ? "stockout" : "ok")),
  }));
  const stockouts = inventory.filter((i) => i.onHand <= 0 || i.status === "stockout");

  const staffEvent = latestByType(events, "staffing_snapshot");
  const cooksOnFloor =
    typeof staffEvent?.payload.cooksOnFloor === "number"
      ? staffEvent.payload.cooksOnFloor
      : null;
  const cooksRequired =
    typeof staffEvent?.payload.required === "number"
      ? staffEvent.payload.required
      : null;
  const staffingStatus =
    typeof staffEvent?.payload.status === "string"
      ? staffEvent.payload.status
      : null;

  const replenishments = events
    .filter((e) => e.type === "replenishment")
    .map((e) => ({
      sku: String(e.payload.sku ?? "unknown"),
      qtyAdded: Number(e.payload.qtyAdded) || 0,
      at: e.occurredAt.toISOString(),
      source:
        typeof e.payload.source === "string" ? e.payload.source : undefined,
    }));

  const deliveryOversell = events
    .filter((e) => e.type === "delivery_accept")
    .map((e) => ({
      channel: String(e.payload.channel ?? "delivery"),
      accepted: Number(e.payload.accepted) || 0,
      kitchenSlotCap: Number(e.payload.kitchenSlotCap) || 0,
      oversellBy: Number(e.payload.oversellBy) || 0,
    }))
    .filter((d) => d.oversellBy > 0 || d.accepted > d.kitchenSlotCap);

  const itemUnavailableCancels = events.filter(
    (e) =>
      e.type === "cancellation" &&
      String(e.payload.reason || "") === "item_unavailable",
  ).length;

  let inferredRootCause: KitchenState["inferredRootCause"] = "operational_overload";

  if (stockouts.length && replenishments.length) {
    inferredRootCause = "inventory_shortage_recovering";
    notes.push("Stockout observed then replenishment mid-window — usable supply returned.");
  } else if (stockouts.length || itemUnavailableCancels >= 2) {
    inferredRootCause = "inventory_shortage";
    notes.push("Hero SKU stockout / item_unavailable cancels dominate.");
  } else if (
    staffingStatus === "shortfall" ||
    (cooksOnFloor != null &&
      cooksRequired != null &&
      cooksOnFloor < cooksRequired)
  ) {
    inferredRootCause = "staffing_shortfall";
    notes.push("Cooks on floor below required — capacity overload from staffing.");
  } else if (deliveryOversell.length) {
    inferredRootCause = "delivery_oversell";
    notes.push("Aggregator accepts exceeded kitchen slot cap — oversell ≠ kitchen shortage.");
  } else if (
    inventory.length &&
    stockouts.length === 0 &&
    (staffingStatus === "ok" || staffingStatus == null)
  ) {
    // Likely capacity pressure if we are in an incident path
    inferredRootCause = "capacity_pressure";
    notes.push("Inventory & staffing OK — pressure is throughput / demand.");
  }

  if (scenarioId === "G1") {
    inferredRootCause = "none";
    notes.push("G1 normal lunch — no false shortage.");
  }

  return {
    inventory,
    stockouts,
    cooksOnFloor,
    cooksRequired,
    staffingStatus,
    replenishments,
    deliveryOversell,
    scenarioId,
    inferredRootCause,
    notes,
  };
}
