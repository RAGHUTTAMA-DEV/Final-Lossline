import { env } from "./config/env.js";
import { closePool, pingDb } from "./db/pool.js";
import { detectionLoop } from "./loops/detection.js";
import { investigationLoop } from "./loops/investigationLoop.js";
import { outcomeLoop } from "./loops/outcome.js";
import { closeRedis, initRedis } from "./redis/client.js";
import { ensureConsumerGroup } from "./redis/streams.js";

async function main(): Promise<void> {
  const dbOk = await pingDb();
  if (!dbOk) {
    throw new Error("Postgres unavailable — worker cannot start");
  }
  console.log("[worker] Postgres connected");

  const redisOk = await initRedis();
  if (redisOk) {
    await ensureConsumerGroup();
  } else {
    console.warn("[worker] Redis down — detection will poll Postgres events");
  }

  const signal = { stopped: false };

  const shutdown = async (sig: string) => {
    console.log(`[worker] ${sig} received, stopping…`);
    signal.stopped = true;
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(
    `[worker] LOSSLine worker (store=${env.STORE_ID}) — detection + investigation + outcome`,
  );

  await Promise.all([
    detectionLoop(signal),
    investigationLoop(signal),
    outcomeLoop(signal),
  ]);
}

main().catch((err: unknown) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
