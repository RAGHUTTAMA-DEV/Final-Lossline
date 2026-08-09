import { Router } from "express";
import { env } from "../config/env.js";
import { pingDb } from "../db/pool.js";
import { getRedisAvailable } from "../redis/client.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const dbOk = await pingDb();
  const redisOk = getRedisAvailable();

  const payload = {
    ok: dbOk,
    db: dbOk,
    redis: redisOk,
    storeId: env.STORE_ID,
    env: env.NODE_ENV,
  };

  res.status(dbOk ? 200 : 503).json(payload);
});
