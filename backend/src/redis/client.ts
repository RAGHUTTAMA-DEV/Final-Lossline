import { Redis } from "ioredis";
import { env } from "../config/env.js";

let redis: Redis | null = null;
let redisAvailable = false;

export function getRedisAvailable(): boolean {
  return redisAvailable;
}

export function getRedis(): Redis | null {
  return redis;
}

export async function initRedis(): Promise<boolean> {
  if (redis) {
    return redisAvailable;
  }

  let client: Redis | null = null;

  try {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    client.on("error", (err: Error) => {
      console.warn("[redis] error:", err.message);
      redisAvailable = false;
    });

    client.on("end", () => {
      redisAvailable = false;
    });

    await client.connect();
    await client.ping();

    redis = client;
    redisAvailable = true;
    console.log("[redis] connected");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[redis] unavailable — Phase 1 can fall back to Postgres polling: ${message}`);
    if (client) {
      try {
        client.disconnect();
      } catch {
        // ignore cleanup errors
      }
    }
    redisAvailable = false;
    redis = null;
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  } finally {
    redis = null;
    redisAvailable = false;
  }
}
