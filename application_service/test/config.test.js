import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

const environment = {
  DATABASE_URL: "postgresql://app:password@localhost/app",
  REDIS_URL: "redis://localhost:6379/0",
  JWT_PUBLIC_KEY: "public\\nkey",
  JWT_ISSUER: "auth-service",
  JWT_AUDIENCE: "infraops",
  BUILD_SERVICE_TOKEN: "test-service-token-with-at-least-32-characters",
};

test("configuration defaults and inline multiline public keys are explicit", async () => {
  const config = await loadConfig(environment);
  assert.equal(config.jwt.publicKey, "public\nkey");
  assert.equal(config.buildQueue, "build");
  assert.equal(config.port, 3000);
  assert.deepEqual(config.corsOrigins, []);
});

test("missing keys, short service secrets, and invalid protocol settings fail at startup", async () => {
  for (const overrides of [
    { JWT_PUBLIC_KEY: undefined },
    { JWT_PUBLIC_KEY_FILE: "also-set.pem" },
    { BUILD_SERVICE_TOKEN: "short" },
    { JWT_ISSUER: "" },
    { JWT_AUDIENCE: "" },
    { DATABASE_URL: "http://localhost/db" },
    { REDIS_URL: "http://localhost/redis" },
    { CORS_ORIGINS: "*" },
    { CORS_ORIGINS: "https://example.com/path" },
    { BUILD_QUEUE: "build\nother" },
    { CELERY_KEY_PREFIX: "\u03bb:" },
  ])
    await assert.rejects(loadConfig({ ...environment, ...overrides }));
});
