import { pool } from "../db/pool.js";
import { primaryStoreId } from "../portfolio/stores.js";
import { buildPortfolioSeedEvents } from "../portfolio/seedProfiles.js";
import { updateRollingMetrics } from "./metrics.js";
import type { IngestEventInput } from "./events.js";

export interface SeedPortfolioResult {
  keepPrimary: boolean;
  wipedStoreIds: string[];
  eventsDeleted: number;
  eventsInserted: number;
  storeIds: string[];
  metricsRefreshed: string[];
}

async function wipeStores(storeIds: string[]): Promise<number> {
  let deleted = 0;
  for (const id of storeIds) {
    const ev = await pool.query(`DELETE FROM events WHERE store_id = $1`, [id]);
    await pool.query(`DELETE FROM rolling_metrics WHERE store_id = $1`, [id]);
    deleted += ev.rowCount ?? 0;
  }
  return deleted;
}

async function bulkInsert(
  events: IngestEventInput[],
  chunkSize = 200,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const e of chunk) {
      placeholders.push(
        `($${p++}, $${p++}, $${p++}::jsonb, $${p++}::timestamptz)`,
      );
      values.push(
        e.storeId,
        e.type,
        JSON.stringify(e.payload ?? {}),
        e.occurredAt ? new Date(e.occurredAt) : new Date(),
      );
    }
    await pool.query(
      `INSERT INTO events (store_id, type, payload, occurred_at)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
    inserted += chunk.length;
  }
  return inserted;
}

/** Wipe + insert 7-day Meghana outlet profiles for seeded stores. */
export async function seedPortfolio(options?: {
  keepPrimary?: boolean;
  days?: number;
}): Promise<SeedPortfolioResult> {
  const keepPrimary = options?.keepPrimary ?? false;
  const days = options?.days ?? 7;
  const { storeIds, events } = buildPortfolioSeedEvents(days);
  const primary = primaryStoreId();

  const wipeIds = keepPrimary
    ? storeIds.filter((id) => id !== primary)
    : storeIds;

  const eventsDeleted = await wipeStores(wipeIds);

  const toInsert = keepPrimary
    ? events.filter((e) => e.storeId !== primary)
    : events;

  const eventsInserted = await bulkInsert(toInsert);

  const metricsRefreshed: string[] = [];
  for (const id of storeIds) {
    if (keepPrimary && id === primary) continue;
    await updateRollingMetrics(id);
    metricsRefreshed.push(id);
  }

  return {
    keepPrimary,
    wipedStoreIds: wipeIds,
    eventsDeleted,
    eventsInserted,
    storeIds,
    metricsRefreshed,
  };
}
