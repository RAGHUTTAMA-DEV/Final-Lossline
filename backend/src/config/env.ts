import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STORE_ID: z.string().min(1).default("store_demo_01"),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  REDIS_STREAM_KEY: z.string().default("lossline:events"),
  REDIS_CONSUMER_GROUP: z.string().default("lossline-detectors"),
  REDIS_CONSUMER_NAME: z.string().default("detector-1"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  THRESHOLD_ORDER_VELOCITY_SPIKE: z.coerce.number().default(1.8),
  THRESHOLD_PREP_TIME_MINUTES: z.coerce.number().default(18),
  THRESHOLD_CANCEL_RATE: z.coerce.number().default(0.12),
  THRESHOLD_HANDOFF_DELAY_MINUTES: z.coerce.number().default(8),
  DETECTION_INTERVAL_MS: z.coerce.number().int().default(5000),
  OUTCOME_POLL_INTERVAL_MS: z.coerce.number().int().default(10000),
  OUTCOME_WINDOW_MS: z.coerce.number().int().default(120_000),

  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(6),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
