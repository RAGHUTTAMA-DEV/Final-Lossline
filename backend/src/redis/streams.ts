import { env } from "../config/env.js";
import { getRedis, getRedisAvailable } from "./client.js";

export type StreamEventFields = Record<string, string>;

export interface StreamMessage {
  id: string;
  fields: StreamEventFields;
}

type XReadGroupResult = [string, [string, string[]][]][] | null;

function assertRedis() {
  const client = getRedis();
  if (!client || !getRedisAvailable()) {
    throw new Error("Redis is not available");
  }
  return client;
}

/** Create consumer group if missing. Safe to call repeatedly. */
export async function ensureConsumerGroup(): Promise<void> {
  if (!getRedisAvailable()) return;

  const client = assertRedis();
  try {
    await client.xgroup(
      "CREATE",
      env.REDIS_STREAM_KEY,
      env.REDIS_CONSUMER_GROUP,
      "0",
      "MKSTREAM",
    );
    console.log(
      `[redis] consumer group ready: ${env.REDIS_CONSUMER_GROUP} on ${env.REDIS_STREAM_KEY}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("BUSYGROUP")) {
      return;
    }
    throw err;
  }
}

/** XADD event fields onto the stream. Returns the stream entry id. */
export async function addEvent(fields: StreamEventFields): Promise<string> {
  const client = assertRedis();
  const flat: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    flat.push(key, value);
  }
  const id = await client.xadd(env.REDIS_STREAM_KEY, "*", ...flat);
  if (!id) {
    throw new Error("Redis XADD returned null");
  }
  return id;
}

/** XREADGROUP for new messages for this consumer. */
export async function readNew(count = 50): Promise<StreamMessage[]> {
  const client = assertRedis();
  const result = (await client.xreadgroup(
    "GROUP",
    env.REDIS_CONSUMER_GROUP,
    env.REDIS_CONSUMER_NAME,
    "COUNT",
    String(count),
    "BLOCK",
    "1000",
    "STREAMS",
    env.REDIS_STREAM_KEY,
    ">",
  )) as XReadGroupResult;

  if (!result) return [];

  const messages: StreamMessage[] = [];
  for (const [, entries] of result) {
    for (const [id, rawFields] of entries) {
      const fields: StreamEventFields = {};
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }
      messages.push({ id, fields });
    }
  }
  return messages;
}

/** Acknowledge processed stream message ids. */
export async function ackMessages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const client = assertRedis();
  await client.xack(env.REDIS_STREAM_KEY, env.REDIS_CONSUMER_GROUP, ...ids);
}
