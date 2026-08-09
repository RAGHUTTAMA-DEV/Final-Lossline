import { env } from "../config/env.js";
import { getRedisAvailable } from "../redis/client.js";
import { ackMessages, readNew } from "../redis/streams.js";
import { detectForStore } from "../services/detection.js";
import { getEventsAfterId, listActiveStoreIds } from "../services/events.js";
import { sleep } from "../utils/sleep.js";

let postgresCursor: string | null = null;

async function drainRedisHints(): Promise<Set<string>> {
  const stores = new Set<string>();
  if (!getRedisAvailable()) return stores;

  try {
    const messages = await readNew(100);
    if (messages.length === 0) return stores;

    const ids: string[] = [];
    for (const msg of messages) {
      ids.push(msg.id);
      if (msg.fields.storeId) {
        stores.add(msg.fields.storeId);
      }
    }
    await ackMessages(ids);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[detection] Redis read failed, using Postgres: ${message}`);
  }

  return stores;
}

async function drainPostgresHints(): Promise<Set<string>> {
  const stores = new Set<string>();
  try {
    const events = await getEventsAfterId(postgresCursor, 200);
    if (events.length === 0) return stores;

    for (const event of events) {
      stores.add(event.storeId);
      postgresCursor = event.id;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[detection] Postgres cursor read failed: ${message}`);
  }
  return stores;
}

/**
 * Deterministic detection loop — no LLM.
 * Reads new-event hints from Redis (or Postgres), refreshes rolling metrics,
 * and creates DETECTED incidents when overload thresholds fire.
 */
export async function detectionLoop(signal?: { stopped: boolean }): Promise<void> {
  console.log(
    `[detection] loop started (interval=${env.DETECTION_INTERVAL_MS}ms)`,
  );

  while (!signal?.stopped) {
    try {
      const stores = new Set<string>();

      const fromRedis = await drainRedisHints();
      for (const id of fromRedis) stores.add(id);

      // Always also advance Postgres cursor so Redis-down mode works
      const fromPg = await drainPostgresHints();
      for (const id of fromPg) stores.add(id);

      if (stores.size === 0) {
        // Still evaluate active stores so delayed threshold crossings are caught
        for (const id of await listActiveStoreIds(30)) {
          stores.add(id);
        }
      }

      for (const storeId of stores) {
        await detectForStore(storeId);
      }
    } catch (err) {
      console.error("[detection] tick failed:", err);
    }

    await sleep(env.DETECTION_INTERVAL_MS);
  }
}
