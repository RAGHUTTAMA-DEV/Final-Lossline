import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closePool, pingDb } from "./db/pool.js";
import { closeRedis, initRedis } from "./redis/client.js";
import { ensureConsumerGroup } from "./redis/streams.js";

async function main(): Promise<void> {
  const dbOk = await pingDb();
  if (!dbOk) {
    console.warn("[boot] Postgres ping failed — /health will report db: false");
  } else {
    console.log("[boot] Postgres connected");
  }

  const redisOk = await initRedis();
  if (redisOk) {
    await ensureConsumerGroup();
  }

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    console.log(`[boot] LOSSLine API listening on :${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[boot] ${signal} received, shutting down…`);
    server.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
