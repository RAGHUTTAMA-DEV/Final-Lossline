import type { IngestEventInput } from "../services/events.js";
import { getPortfolio, primaryStoreId, type PortfolioStore } from "./stores.js";

const MENU = {
  chicken: { sku: "chicken_dum", name: "Chicken Dum Biryani" },
  mutton: { sku: "mutton", name: "Mutton Biryani" },
  egg: { sku: "egg", name: "Egg Biryani" },
  kabab: { sku: "kabab", name: "Chicken Kabab" },
} as const;

export type OutletProfile = "koramangala" | "jayanagar" | "indiranagar";

interface DayParams {
  ordersPerDay: number;
  cancelRate: number;
  prepMin: [number, number];
  handoffMin: [number, number];
  reviewRatings: number[];
  inventoryOnHand: Record<string, number>;
  cooksOnFloor: number;
  cooksRequired: number;
  avgTicket: number;
}

const PROFILES: Record<OutletProfile, DayParams> = {
  koramangala: {
    ordersPerDay: 42,
    cancelRate: 0.09,
    prepMin: [16, 28],
    handoffMin: [5, 12],
    reviewRatings: [3, 3, 4, 4, 4, 5, 2, 4],
    inventoryOnHand: {
      chicken_dum: 40,
      mutton: 22,
      egg: 55,
      kabab: 30,
    },
    cooksOnFloor: 5,
    cooksRequired: 5,
    avgTicket: 420,
  },
  jayanagar: {
    ordersPerDay: 36,
    cancelRate: 0.035,
    prepMin: [12, 18],
    handoffMin: [3, 7],
    reviewRatings: [4, 5, 5, 4, 5, 5, 4, 5],
    inventoryOnHand: {
      chicken_dum: 70,
      mutton: 45,
      egg: 80,
      kabab: 50,
    },
    cooksOnFloor: 6,
    cooksRequired: 5,
    avgTicket: 390,
  },
  indiranagar: {
    ordersPerDay: 38,
    cancelRate: 0.15,
    prepMin: [20, 34],
    handoffMin: [8, 16],
    reviewRatings: [2, 1, 3, 2, 4, 2, 3, 1],
    inventoryOnHand: {
      chicken_dum: 8,
      mutton: 0,
      egg: 25,
      kabab: 12,
    },
    cooksOnFloor: 3,
    cooksRequired: 5,
    avgTicket: 410,
  },
};

function profileForStore(store: PortfolioStore): OutletProfile | null {
  const n = store.name.toLowerCase();
  if (n.includes("koramangala")) return "koramangala";
  if (n.includes("jayanagar")) return "jayanagar";
  if (n.includes("indiranagar")) return "indiranagar";
  return null;
}

function isoDaysAgo(days: number, hour = 12, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function reviewText(rating: number, outlet: string): string {
  if (rating >= 5) return `Excellent biryani at ${outlet} — hot and on time.`;
  if (rating >= 4) return `Good food at ${outlet}, solid portion.`;
  if (rating >= 3) return `Okay at ${outlet}, bit slow today.`;
  if (rating >= 2) return `Late order from ${outlet}, rice was dry.`;
  return `Very poor experience at ${outlet} — cancelled once, cold food.`;
}

/** Build ~7 days of POS / review / inventory / staffing events for one outlet. */
export function buildOutletSeedEvents(
  storeId: string,
  profile: OutletProfile,
  days = 7,
): IngestEventInput[] {
  const p = PROFILES[profile];
  const events: IngestEventInput[] = [];
  const brand = "Meghana Biryani";

  for (let day = days - 1; day >= 0; day--) {
    const dayJitter = 1 + ((day % 3) - 1) * 0.06;
    const orderCount = Math.max(20, Math.round(p.ordersPerDay * dayJitter));
    const cancelCount = Math.max(0, Math.round(orderCount * p.cancelRate));

    // Midday inventory + staffing snapshots
    const invScale = profile === "indiranagar" && day <= 2 ? 0.4 : 1;
    events.push({
      storeId,
      type: "inventory_snapshot",
      occurredAt: isoDaysAgo(day, 11, 0),
      payload: {
        brand,
        outlet: profile,
        seed: "portfolio",
        items: Object.entries(p.inventoryOnHand).map(([sku, onHand]) => {
          const qty = Math.max(0, Math.round(onHand * invScale));
          const meta = Object.values(MENU).find((m) => m.sku === sku);
          return {
            sku,
            name: meta?.name ?? sku,
            onHand: qty,
            status: qty <= 0 ? "stockout" : qty < 15 ? "low" : "ok",
          };
        }),
      },
    });

    events.push({
      storeId,
      type: "staffing_snapshot",
      occurredAt: isoDaysAgo(day, 11, 5),
      payload: {
        brand,
        outlet: profile,
        seed: "portfolio",
        cooksOnFloor: p.cooksOnFloor,
        required: p.cooksRequired,
        status: p.cooksOnFloor < p.cooksRequired ? "shortfall" : "ok",
      },
    });

    for (let i = 0; i < orderCount; i++) {
      const hour = 11 + Math.floor((i / orderCount) * 10);
      const minute = (i * 7) % 60;
      const t = i / Math.max(1, orderCount - 1);
      const amount = Math.round(p.avgTicket * (0.85 + (i % 5) * 0.05));

      events.push({
        storeId,
        type: "order",
        occurredAt: isoDaysAgo(day, hour, minute),
        payload: {
          brand,
          outlet: profile,
          seed: "portfolio",
          amount,
          channel: i % 3 === 0 ? "swiggy" : i % 3 === 1 ? "zomato" : "dine_in",
          items: [pick(Object.values(MENU), i).name],
        },
      });

      events.push({
        storeId,
        type: "prep_complete",
        occurredAt: isoDaysAgo(day, hour, (minute + 18) % 60),
        payload: {
          brand,
          outlet: profile,
          seed: "portfolio",
          prepMinutes: Math.round(lerp(p.prepMin[0], p.prepMin[1], t)),
        },
      });

      events.push({
        storeId,
        type: "handoff",
        occurredAt: isoDaysAgo(day, hour, (minute + 25) % 60),
        payload: {
          brand,
          outlet: profile,
          seed: "portfolio",
          delayMinutes: Math.round(lerp(p.handoffMin[0], p.handoffMin[1], t)),
        },
      });
    }

    for (let c = 0; c < cancelCount; c++) {
      events.push({
        storeId,
        type: "cancellation",
        occurredAt: isoDaysAgo(day, 14 + (c % 6), (c * 11) % 60),
        payload: {
          brand,
          outlet: profile,
          seed: "portfolio",
          reason:
            profile === "indiranagar" && c % 2 === 0
              ? "item_unavailable"
              : "customer_wait",
          amount: Math.round(p.avgTicket * 0.9),
        },
      });
    }

    // ~8 reviews / day from the rating distribution
    for (let r = 0; r < p.reviewRatings.length; r++) {
      const rating = p.reviewRatings[r];
      events.push({
        storeId,
        type: "review",
        occurredAt: isoDaysAgo(day, 18 + (r % 4), (r * 9) % 60),
        payload: {
          brand,
          outlet: profile,
          seed: "portfolio",
          rating,
          stars: rating,
          text: reviewText(rating, profile),
          channel: r % 2 === 0 ? "swiggy" : "zomato",
        },
      });
    }
  }

  return events;
}

/** Events for every seeded portfolio outlet (Koramangala / Jayanagar / Indiranagar). */
export function buildPortfolioSeedEvents(days = 7): {
  storeIds: string[];
  events: IngestEventInput[];
} {
  const events: IngestEventInput[] = [];
  const storeIds: string[] = [];

  for (const store of getPortfolio().filter((s) => s.seeded)) {
    const profile = profileForStore(store);
    if (!profile) continue;
    const id = store.name === "Koramangala" ? primaryStoreId() : store.id;
    storeIds.push(id);
    events.push(...buildOutletSeedEvents(id, profile, days));
  }

  return { storeIds, events };
}
