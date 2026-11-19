import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT, importPKCS8 } from "jose";
import pg from "pg";
import { createApp } from "../src/app.js";
import { createDatabase, migrate } from "../src/database.js";

const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const signingKey = await importPKCS8(keyPair.privateKey, "RS256");

export const applicationInput = {
  name: "sample-app",
  repository: "https://github.com/example/sample",
  application_type: "node",
  port: 3000,
};

export function successfulResult(applicationId, overrides = {}) {
  return {
    build_id: randomUUID(),
    application_id: applicationId,
    status: "success",
    image_repository: "registry.example.com/infraops/sample-app",
    image_tag: "a82f91c",
    image_digest: `sha256:${"a".repeat(64)}`,
    commit_sha: "a82f91c",
    error_message: null,
    started_at: "2026-11-06T12:00:00Z",
    finished_at: "2026-11-06T12:04:31Z",
    ...overrides,
  };
}

export async function tokenFor(userId = 42, claims = {}) {
  return new SignJWT({
    user_id: userId,
    token_type: "access",
    iss: "auth-service",
    aud: "infraops",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(signingKey);
}

export async function testDatabase() {
  if (!process.env.TEST_DATABASE_URL) {
    const database = new PGlite();
    await migrate(database);
    database.engine = "pglite";
    return database;
  }

  // Real-Postgres tests get their own schema and never truncate an existing service schema.
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database = createDatabase(process.env.TEST_DATABASE_URL, {
    options: `-c search_path=${schema}`,
  });
  const close = database.close;
  database.close = async () => {
    await close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  };
  database.engine = "postgres";
  await migrate(database);
  return database;
}

export async function createHarness(database, overrides = {}) {
  const config = {
    jwt: {
      publicKey: keyPair.publicKey,
      issuer: "auth-service",
      audience: "infraops",
    },
    buildServiceToken: "test-only-service-token-not-a-production-secret",
    buildRateLimit: 100,
    buildRateWindowSeconds: 60,
    corsOrigins: ["http://localhost:5173"],
    ...overrides,
  };
  const publisher = {
    calls: [],
    behavior: null,
    async publish(payload) {
      this.calls.push(structuredClone(payload));
      if (this.behavior) await this.behavior(payload);
    },
  };
  const logger = { error() {}, warn() {} };
  const app = await createApp({ database, publisher, config, logger });
  return { app, publisher, config, logger };
}
