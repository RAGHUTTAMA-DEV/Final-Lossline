import { env } from "../config/env.js";

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PortfolioStore {
  id: string;
  name: string;
  area: string;
  icon: string;
  lat: number;
  lng: number;
  /** When true, analytics/compare read real events from Postgres. */
  seeded: boolean;
  /** Fallback demo rating when not seeded / no review events yet. */
  demoRating: number;
  /** Fallback revenue delta % for non-seeded map cards. */
  demoRevDelta: number;
  /** Fallback risk for non-seeded companions. */
  demoRisk: RiskLevel;
}

/** Primary live kitchen — always the env STORE_ID (Koramangala in demos). */
export function primaryStoreId(): string {
  return env.STORE_ID;
}

/**
 * Meghana Biryani portfolio. Three outlets are seeded for Location Analytics;
 * the rest remain map companions until seeded later.
 */
export const PORTFOLIO_STORES: PortfolioStore[] = [
  {
    id: "store_demo_01",
    name: "Koramangala",
    area: "Meghana Biryani · live kitchen",
    icon: "⚡",
    lat: 12.9352,
    lng: 77.6245,
    seeded: true,
    demoRating: 4.1,
    demoRevDelta: -8,
    demoRisk: "MEDIUM",
  },
  {
    id: "meghana_jayanagar",
    name: "Jayanagar",
    area: "Meghana Biryani · 4th Block",
    icon: "🏡",
    lat: 12.9308,
    lng: 77.5838,
    seeded: true,
    demoRating: 4.5,
    demoRevDelta: 6,
    demoRisk: "LOW",
  },
  {
    id: "meghana_indiranagar",
    name: "Indiranagar",
    area: "Meghana Biryani · 100 Feet Rd",
    icon: "🏙️",
    lat: 12.9784,
    lng: 77.6408,
    seeded: true,
    demoRating: 3.7,
    demoRevDelta: -22,
    demoRisk: "HIGH",
  },
  {
    id: "meghana_airport",
    name: "Airport",
    area: "Meghana · T2 food court",
    icon: "✈️",
    lat: 13.1986,
    lng: 77.7066,
    seeded: false,
    demoRating: 3.8,
    demoRevDelta: -14,
    demoRisk: "HIGH",
  },
  {
    id: "meghana_hsr",
    name: "HSR Hub",
    area: "Meghana · central kitchen",
    icon: "🏭",
    lat: 12.9116,
    lng: 77.6473,
    seeded: false,
    demoRating: 4.4,
    demoRevDelta: 8,
    demoRisk: "LOW",
  },
  {
    id: "meghana_whitefield",
    name: "Whitefield",
    area: "Meghana · ITPL road",
    icon: "🏢",
    lat: 12.9698,
    lng: 77.75,
    seeded: false,
    demoRating: 4.5,
    demoRevDelta: 3,
    demoRisk: "LOW",
  },
];

/** Runtime portfolio with Koramangala id bound to env.STORE_ID. */
export function getPortfolio(): PortfolioStore[] {
  return PORTFOLIO_STORES.map((s) =>
    s.name === "Koramangala" ? { ...s, id: primaryStoreId() } : s,
  );
}

export function getPortfolioStore(storeId: string): PortfolioStore | undefined {
  return getPortfolio().find((s) => s.id === storeId);
}

export function seededStores(): PortfolioStore[] {
  return getPortfolio().filter((s) => s.seeded);
}

export const MAP_CENTER = { lat: 12.97, lng: 77.64 };
