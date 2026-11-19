import { readFile } from "node:fs/promises";
import { z } from "zod";

const databaseUrl = z.url().refine((value) => {
  return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
}, "DATABASE_URL must use postgres:// or postgresql://");

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: databaseUrl,
  REDIS_URL: z.url().refine((value) => {
    return ["redis:", "rediss:"].includes(new URL(value).protocol);
  }, "REDIS_URL must use redis:// or rediss://"),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PUBLIC_KEY_FILE: z.string().optional(),
  BUILD_SERVICE_TOKEN: z.string().min(32),
  BUILD_QUEUE: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
    .default("build"),
  CELERY_KEY_PREFIX: z
    .string()
    .regex(/^[\x20-\x7e]*$/)
    .default(""),
  BUILD_PUBLISH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(2000),
  BUILD_PUBLISH_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  BUILD_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  BUILD_RATE_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86400)
    .default(60),
  CORS_ORIGINS: z.string().default(""),
});

export function readDatabaseUrl(environment = process.env) {
  return databaseUrl.parse(environment.DATABASE_URL);
}

export async function loadConfig(environment = process.env) {
  const env = environmentSchema.parse(environment);
  if (Boolean(env.JWT_PUBLIC_KEY) === Boolean(env.JWT_PUBLIC_KEY_FILE)) {
    throw new Error(
      "Set exactly one of JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_FILE.",
    );
  }

  const publicKey = env.JWT_PUBLIC_KEY
    ? env.JWT_PUBLIC_KEY.replaceAll("\\n", "\n")
    : await readFile(env.JWT_PUBLIC_KEY_FILE, "utf8");

  const corsOrigins = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error(
        "CORS_ORIGINS must contain exact HTTP(S) origins, without paths.",
      );
    }
  }

  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwt: { publicKey, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    buildServiceToken: env.BUILD_SERVICE_TOKEN,
    buildQueue: env.BUILD_QUEUE,
    celeryKeyPrefix: env.CELERY_KEY_PREFIX,
    publishTimeoutMs: env.BUILD_PUBLISH_TIMEOUT_MS,
    publishAttempts: env.BUILD_PUBLISH_ATTEMPTS,
    buildRateLimit: env.BUILD_RATE_LIMIT,
    buildRateWindowSeconds: env.BUILD_RATE_WINDOW_SECONDS,
    corsOrigins,
  };
}
