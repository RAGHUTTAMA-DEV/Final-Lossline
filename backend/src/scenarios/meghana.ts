import type { IngestEventInput } from "../services/events.js";

export type ScenarioId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

export interface ScenarioMeta {
  id: ScenarioId;
  name: string;
  proves: string;
  brand: "Meghana Biryani";
  outlet: string;
  story: string;
  expectIncident: boolean;
  expectedRootCause: string;
  expectedActionHint: string;
  liveBeats: string[];
}

export interface BuiltScenario {
  meta: ScenarioMeta;
  events: IngestEventInput[];
}

const MENU = {
  chicken: "Chicken Dum Biryani",
  mutton: "Mutton Biryani",
  egg: "Egg Biryani",
  kabab: "Chicken Kabab",
} as const;

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function tag(
  storeId: string,
  scenarioId: ScenarioId,
  type: IngestEventInput["type"],
  payload: Record<string, unknown>,
  occurredAt: string,
): IngestEventInput {
  return {
    storeId,
    type,
    occurredAt,
    payload: {
      brand: "Meghana Biryani",
      outlet: "Koramangala",
      scenarioId,
      ...payload,
    },
  };
}

export const SCENARIO_CATALOG: ScenarioMeta[] = [
  {
    id: "G1",
    name: "Normal lunch",
    proves: "No false shortage",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Steady lunch rush. Chicken Dum & Mutton on the line, full staff, no cancel spike. LOSSLine must stay quiet.",
    expectIncident: false,
    expectedRootCause: "none — healthy service",
    expectedActionHint: "No action — prove we do not cry wolf",
    liveBeats: [
      "Orders flowing at normal lunch pace",
      "Inventory healthy on hero SKUs",
      "Prep & handoff within SLA",
      "Expect: no DETECTED incident",
    ],
  },
  {
    id: "G2",
    name: "Demand spike, stock OK",
    proves: "Capacity pressure",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Swiggy + Zomato blast during IPL break. Rice pots and chicken stock are fine — the kitchen just cannot plate fast enough.",
    expectIncident: true,
    expectedRootCause: "capacity_pressure (inventory OK)",
    expectedActionHint: "call_in_prep_staff or throttle_new_orders / pause_delivery",
    liveBeats: [
      "Order velocity spikes vs 60m baseline",
      "Inventory still green on Chicken Dum",
      "Prep time & cancels climb",
      "Root cause ≠ stockout",
    ],
  },
  {
    id: "G3",
    name: "Stockout",
    proves: "Inventory shortage",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Chicken Dum hits zero mid-lunch. Guests cancel 'item unavailable' while Mutton still shows on aggregators.",
    expectIncident: true,
    expectedRootCause: "inventory_shortage",
    expectedActionHint: "emergency_stock_transfer or eighty_six_sku",
    liveBeats: [
      "Chicken Dum Biryani stock → 0",
      "Cancels reason: item_unavailable",
      "Staff headcount still fine",
      "Prove inventory — not capacity — is the driver",
    ],
  },
  {
    id: "G4",
    name: "Mid-window replenishment",
    proves: "Usable supply + replenishment",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Short stockout on Chicken Dum, then a van drops 40 portions mid-window. System should see usable supply return — not lock into permanent shortage.",
    expectIncident: true,
    expectedRootCause: "inventory_shortage_recovering",
    expectedActionHint: "extend_prep_eta briefly, then clear shortage after replenish",
    liveBeats: [
      "Stock hits zero → cancels spike",
      "Replenishment event: +40 Chicken Dum",
      "Inventory recovers inside the window",
      "Prove replenishment is usable signal",
    ],
  },
  {
    id: "G5",
    name: "Staffing shortfall",
    proves: "Capacity overload",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Two cooks called in sick. Stock is full, demand is only mildly up — plates stall because people are missing, not rice.",
    expectIncident: true,
    expectedRootCause: "staffing_shortfall",
    expectedActionHint: "call_in_prep_staff",
    liveBeats: [
      "On-floor cooks drop 6 → 3",
      "Inventory still healthy",
      "Prep & handoff blow past SLA",
      "Root cause = staffing, not stockout",
    ],
  },
  {
    id: "G6",
    name: "Delivery oversell",
    proves: "Oversell ≠ kitchen shortage",
    brand: "Meghana Biryani",
    outlet: "Koramangala",
    story:
      "Aggregator keeps accepting orders past kitchen slot cap. Walk-in counter is fine and stock is fine — oversell created the mess.",
    expectIncident: true,
    expectedRootCause: "delivery_oversell",
    expectedActionHint: "pause_delivery / throttle aggregator intake",
    liveBeats: [
      "Delivery accepts exceed kitchen slot cap",
      "Counter channel still healthy",
      "Inventory OK — not an 86",
      "Prove oversell ≠ kitchen shortage",
    ],
  },
];

export function getScenarioMeta(id: string): ScenarioMeta | undefined {
  return SCENARIO_CATALOG.find((s) => s.id === id);
}

/** Build Meghana Biryani replay events for one gold scenario. */
export function buildMeghanaScenario(
  scenarioId: ScenarioId,
  storeId: string,
): BuiltScenario {
  const meta = getScenarioMeta(scenarioId);
  if (!meta) throw new Error(`Unknown scenario ${scenarioId}`);

  const events: IngestEventInput[] = [];
  const push = (
    type: IngestEventInput["type"],
    payload: Record<string, unknown>,
    minutesAgo: number,
  ) => {
    events.push(tag(storeId, scenarioId, type, payload, ago(minutesAgo)));
  };

  // Shared 60m baseline — calm morning so spikes are real
  for (let i = 0; i < 4; i += 1) {
    push(
      "order",
      {
        orderId: `${scenarioId}_base_${i}`,
        amount: 320 + i * 15,
        channel: i % 2 === 0 ? "swiggy" : "counter",
        items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
      },
      55 - i * 8,
    );
  }

  switch (scenarioId) {
    case "G1": {
      // Healthy lunch — under all thresholds
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 48, status: "ok" },
            { sku: "mutton", name: MENU.mutton, onHand: 22, status: "ok" },
          ],
        },
        20,
      );
      push(
        "staffing_snapshot",
        { cooksOnFloor: 6, required: 5, status: "ok", note: "Full lunch crew" },
        18,
      );
      for (let i = 0; i < 6; i += 1) {
        push(
          "order",
          {
            orderId: `G1_ord_${i}`,
            amount: 380 + i * 20,
            channel: i % 3 === 0 ? "zomato" : "swiggy",
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
          },
          14 - i,
        );
      }
      for (let i = 0; i < 5; i += 1) {
        push(
          "prep_complete",
          { orderId: `G1_ord_${i}`, prepMinutes: 12 + (i % 2), sku: "chicken_dum" },
          12 - i,
        );
        push(
          "handoff",
          { orderId: `G1_ord_${i}`, delayMinutes: 3 + (i % 2), channel: "swiggy" },
          11 - i,
        );
      }
      push(
        "review",
        { orderId: "G1_ord_2", rating: 5, text: "Meghana never disappoints — hot dum biryani." },
        4,
      );
      break;
    }
    case "G2": {
      // Capacity pressure — stock OK
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 55, status: "ok" },
            { sku: "mutton", name: MENU.mutton, onHand: 30, status: "ok" },
          ],
          note: "Stock healthy — do not blame inventory",
        },
        16,
      );
      push(
        "staffing_snapshot",
        { cooksOnFloor: 5, required: 5, status: "ok" },
        15,
      );
      for (let i = 0; i < 14; i += 1) {
        push(
          "order",
          {
            orderId: `G2_ord_${i}`,
            amount: 420 + i * 12,
            channel: i % 2 === 0 ? "swiggy" : "zomato",
            campaign: "IPL_halftime_push",
            items: [
              { sku: "chicken_dum", name: MENU.chicken, qty: 1 },
              ...(i % 4 === 0
                ? [{ sku: "kabab", name: MENU.kabab, qty: 1 }]
                : []),
            ],
          },
          14 - i * 0.7,
        );
      }
      for (let i = 0; i < 6; i += 1) {
        push(
          "prep_complete",
          { orderId: `G2_ord_${i}`, prepMinutes: 22 + i, sku: "chicken_dum" },
          10 - i,
        );
      }
      for (let i = 0; i < 5; i += 1) {
        push(
          "handoff",
          { orderId: `G2_ord_${i}`, delayMinutes: 11 + i, channel: "swiggy" },
          8 - i * 0.8,
        );
      }
      for (const i of [2, 5, 8, 11]) {
        push(
          "cancellation",
          {
            orderId: `G2_ord_${i}`,
            reason: "too_long_wait",
            channel: "swiggy",
            note: "Guest waited — food existed",
          },
          6 - i * 0.15,
        );
      }
      push(
        "review",
        { orderId: "G2_ord_5", rating: 2, text: "45 min for Meghana chicken dum. Still hungry." },
        3,
      );
      break;
    }
    case "G3": {
      // Hard stockout on hero SKU
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 0, status: "stockout" },
            { sku: "mutton", name: MENU.mutton, onHand: 18, status: "ok" },
            { sku: "egg", name: MENU.egg, onHand: 12, status: "ok" },
          ],
          note: "Chicken Dum Biryani 86'd",
        },
        15,
      );
      push(
        "staffing_snapshot",
        { cooksOnFloor: 6, required: 5, status: "ok", note: "Staff fine — inventory is the issue" },
        14,
      );
      for (let i = 0; i < 10; i += 1) {
        push(
          "order",
          {
            orderId: `G3_ord_${i}`,
            amount: 390 + i * 10,
            channel: i % 2 === 0 ? "zomato" : "swiggy",
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
            aggregatorStillShowing: true,
          },
          13 - i * 0.9,
        );
      }
      for (let i = 0; i < 3; i += 1) {
        push(
          "prep_complete",
          {
            orderId: `G3_ord_${i}`,
            prepMinutes: 19 + i,
            sku: "mutton",
            note: "Kitchen substituted / delayed",
          },
          9 - i,
        );
      }
      for (const i of [1, 3, 4, 6, 8]) {
        push(
          "cancellation",
          {
            orderId: `G3_ord_${i}`,
            reason: "item_unavailable",
            sku: "chicken_dum",
            itemName: MENU.chicken,
            channel: "zomato",
          },
          7 - i * 0.2,
        );
      }
      push(
        "review",
        {
          orderId: "G3_ord_3",
          rating: 1,
          text: "Ordered Meghana chicken dum — cancelled saying out of stock. Still listed on Zomato!",
        },
        2,
      );
      break;
    }
    case "G4": {
      // Stockout then replenishment mid-window
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 0, status: "stockout" },
            { sku: "mutton", name: MENU.mutton, onHand: 14, status: "ok" },
          ],
          phase: "pre_replenish",
        },
        16,
      );
      push(
        "staffing_snapshot",
        { cooksOnFloor: 5, required: 5, status: "ok" },
        15,
      );
      for (let i = 0; i < 9; i += 1) {
        push(
          "order",
          {
            orderId: `G4_ord_${i}`,
            amount: 400 + i * 8,
            channel: "swiggy",
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
          },
          14 - i,
        );
      }
      for (const i of [1, 3, 5]) {
        push(
          "cancellation",
          {
            orderId: `G4_ord_${i}`,
            reason: "item_unavailable",
            sku: "chicken_dum",
            itemName: MENU.chicken,
          },
          11 - i * 0.3,
        );
      }
      push(
        "prep_complete",
        { orderId: "G4_ord_0", prepMinutes: 21, sku: "mutton" },
        10,
      );
      push(
        "prep_complete",
        { orderId: "G4_ord_2", prepMinutes: 20, sku: "egg" },
        9,
      );
      // Mid-window van arrival
      push(
        "replenishment",
        {
          sku: "chicken_dum",
          name: MENU.chicken,
          qtyAdded: 40,
          source: "central_kitchen_van",
          note: "Emergency transfer from HSR hub",
        },
        7,
      );
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 40, status: "ok" },
            { sku: "mutton", name: MENU.mutton, onHand: 12, status: "ok" },
          ],
          phase: "post_replenish",
          note: "Usable supply restored mid-window",
        },
        6,
      );
      for (let i = 6; i < 9; i += 1) {
        push(
          "prep_complete",
          { orderId: `G4_ord_${i}`, prepMinutes: 14, sku: "chicken_dum" },
          5 - (i - 6),
        );
        push(
          "handoff",
          { orderId: `G4_ord_${i}`, delayMinutes: 4, channel: "swiggy" },
          4 - (i - 6),
        );
      }
      break;
    }
    case "G5": {
      // Staffing shortfall — stock OK
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 60, status: "ok" },
            { sku: "mutton", name: MENU.mutton, onHand: 28, status: "ok" },
          ],
          note: "Stock full — do not call this a shortage",
        },
        16,
      );
      push(
        "staffing_snapshot",
        {
          cooksOnFloor: 3,
          required: 6,
          status: "shortfall",
          absences: ["Ravi (fever)", "Imran (family emergency)"],
          note: "Two cooks out — capacity overload",
        },
        15,
      );
      for (let i = 0; i < 11; i += 1) {
        push(
          "order",
          {
            orderId: `G5_ord_${i}`,
            amount: 360 + i * 15,
            channel: i % 2 === 0 ? "counter" : "swiggy",
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
          },
          13 - i * 0.8,
        );
      }
      for (let i = 0; i < 6; i += 1) {
        push(
          "prep_complete",
          { orderId: `G5_ord_${i}`, prepMinutes: 24 + i, sku: "chicken_dum" },
          9 - i,
        );
      }
      for (let i = 0; i < 5; i += 1) {
        push(
          "handoff",
          { orderId: `G5_ord_${i}`, delayMinutes: 12 + i, channel: "swiggy" },
          7 - i,
        );
      }
      for (const i of [2, 4, 7]) {
        push(
          "cancellation",
          { orderId: `G5_ord_${i}`, reason: "too_long_wait", channel: "swiggy" },
          5 - i * 0.2,
        );
      }
      push(
        "review",
        {
          orderId: "G5_ord_4",
          rating: 2,
          text: "Meghana food good but kitchen looked empty. Took forever.",
        },
        2,
      );
      break;
    }
    case "G6": {
      // Delivery oversell — inventory OK, kitchen not short of food
      push(
        "inventory_snapshot",
        {
          items: [
            { sku: "chicken_dum", name: MENU.chicken, onHand: 50, status: "ok" },
            { sku: "mutton", name: MENU.mutton, onHand: 24, status: "ok" },
          ],
          note: "Kitchen has food — aggregators oversold slots",
        },
        16,
      );
      push(
        "staffing_snapshot",
        { cooksOnFloor: 5, required: 5, status: "ok" },
        15,
      );
      push(
        "delivery_accept",
        {
          channel: "swiggy",
          accepted: 28,
          kitchenSlotCap: 14,
          oversellBy: 14,
          windowMinutes: 15,
          note: "Swiggy kept accepting past prep-slot cap",
        },
        14,
      );
      push(
        "delivery_accept",
        {
          channel: "zomato",
          accepted: 18,
          kitchenSlotCap: 10,
          oversellBy: 8,
          windowMinutes: 15,
        },
        13,
      );
      for (let i = 0; i < 12; i += 1) {
        push(
          "order",
          {
            orderId: `G6_ord_${i}`,
            amount: 410 + i * 10,
            channel: i % 3 === 0 ? "zomato" : "swiggy",
            oversoldSlot: true,
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
          },
          12 - i * 0.7,
        );
      }
      // Counter stays fine — contrast signal
      for (let i = 0; i < 3; i += 1) {
        push(
          "order",
          {
            orderId: `G6_counter_${i}`,
            amount: 350,
            channel: "counter",
            items: [{ sku: "chicken_dum", name: MENU.chicken, qty: 1 }],
          },
          10 - i * 2,
        );
        push(
          "prep_complete",
          { orderId: `G6_counter_${i}`, prepMinutes: 13, channel: "counter" },
          8 - i * 2,
        );
      }
      for (let i = 0; i < 5; i += 1) {
        push(
          "prep_complete",
          {
            orderId: `G6_ord_${i}`,
            prepMinutes: 23 + i,
            channel: "swiggy",
            sku: "chicken_dum",
          },
          7 - i,
        );
        push(
          "handoff",
          { orderId: `G6_ord_${i}`, delayMinutes: 13 + i, channel: "swiggy" },
          6 - i,
        );
      }
      for (const i of [1, 4, 6, 9]) {
        push(
          "cancellation",
          {
            orderId: `G6_ord_${i}`,
            reason: "too_long_wait",
            channel: "swiggy",
            note: "Oversell backlog — not an 86",
          },
          4 - i * 0.15,
        );
      }
      push(
        "review",
        {
          orderId: "G6_ord_4",
          rating: 1,
          text: "Rider waited 25 min outside Meghana. App should not have taken my order.",
        },
        1,
      );
      break;
    }
    default:
      break;
  }

  events.sort(
    (a, b) =>
      new Date(a.occurredAt ?? 0).getTime() - new Date(b.occurredAt ?? 0).getTime(),
  );

  return { meta, events };
}
