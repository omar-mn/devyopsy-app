import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import request from "supertest";
import { SignJWT } from "jose";
import { migrate } from "../src/database.js";
import { BuildPublishError } from "../src/integrations/build-service/publisher.js";
import {
  applicationInput,
  createHarness,
  successfulResult,
  testDatabase,
  tokenFor,
} from "./helpers.js";

let database;
let harness;
let token;

before(async () => {
  database = await testDatabase();
});
after(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.query(
    "TRUNCATE applications, build_throttles RESTART IDENTITY CASCADE",
  );
  harness = await createHarness(database);
  token = await tokenFor();
});

function user(method, path, accessToken = token) {
  return request(harness.app)
    [method](path)
    .set("Authorization", `Bearer ${accessToken}`);
}

function callback(requestId, payload, action = "result") {
  return request(harness.app)
    .post(`/internal/builds/${requestId}/${action}/`)
    .set("Authorization", `Bearer ${harness.config.buildServiceToken}`)
    .send(payload);
}

async function createApplication(overrides = {}, accessToken = token) {
  const response = await user("post", "/applications/", accessToken).send({
    ...applicationInput,
    ...overrides,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function trigger(application) {
  const response = await user(
    "post",
    `/applications/${application.id}/build/`,
  ).send({});
  assert.equal(response.status, 202, JSON.stringify(response.body));
  return response.body;
}

test("create returns server-owned metadata and does not implicitly trigger a build", async () => {
  const app = await createApplication();
  assert.equal(app.owner_id, 42);
  assert.equal(app.repository_url, applicationInput.repository);
  assert.equal(app.branch, "main");
  assert.equal(app.run_command, null);
  assert.equal(app.latest_build_status, "NOT_BUILT");
  assert.equal(harness.publisher.calls.length, 0);
});

test("list contains only owned applications and uses bounded pagination", async () => {
  const older = await createApplication({ name: "older-app" });
  const newer = await createApplication({ name: "newer-app" });
  await createApplication({ name: "foreign-app" }, await tokenFor(99));
  const first = await user("get", "/applications/?limit=1");
  assert.equal(first.body.count, 2);
  assert.equal(first.body.results[0].id, newer.id);
  assert.equal(first.body.next, "/applications/?limit=1&offset=1");
  const second = await user("get", first.body.next);
  assert.equal(second.body.results[0].id, older.id);
  assert.equal(second.body.next, null);
  assert.equal((await user("get", "/applications/?limit=101")).status, 400);
});

test("duplicate names are conflicts only within the same owner", async () => {
  await createApplication();
  const duplicate = await user("post", "/applications/").send(applicationInput);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "duplicate_name");
  await createApplication({}, await tokenFor(99));
  const second = await createApplication({ name: "second-app" });
  assert.equal(
    (
      await user("patch", `/applications/${second.id}/`).send({
        name: applicationInput.name,
      })
    ).status,
    409,
  );
});

test("owner identity and unknown fields cannot be supplied by the client", async () => {
  const response = await user("post", "/applications/").send({
    ...applicationInput,
    owner_id: 99,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "validation_error");
  assert.ok(response.body.error.fields);
  assert.equal(
    response.body.error.request_id,
    response.headers["x-request-id"],
  );
});

test("GET, PATCH, DELETE, build trigger, and history all enforce ownership", async () => {
  const app = await createApplication();
  const foreignToken = await tokenFor(99);
  for (const [method, suffix, body] of [
    ["get", "", undefined],
    ["patch", "", { name: "stolen-app" }],
    ["delete", "", undefined],
    ["post", "build/", {}],
    ["get", "builds/", undefined],
  ]) {
    const call = user(
      method,
      `/applications/${app.id}/${suffix}`,
      foreignToken,
    );
    const response = body === undefined ? await call : await call.send(body);
    assert.equal(response.status, 403, `${method} ${suffix}`);
  }
  assert.equal(harness.publisher.calls.length, 0);
});

test("missing resources and unsafe numeric identifiers are rejected", async () => {
  assert.equal((await user("get", "/applications/999/")).status, 404);
  assert.equal(
    (await user("get", "/applications/9007199254740992/")).status,
    400,
  );
  assert.equal((await user("get", "/applications/1e3/")).status, 400);
});

test("authentication is required and does not accept service tokens as user tokens", async () => {
  const missing = await request(harness.app).get("/applications/");
  assert.equal(missing.status, 401);
  assert.equal(missing.headers["www-authenticate"], "Bearer");
  assert.equal(
    (await user("get", "/applications/", harness.config.buildServiceToken))
      .status,
    401,
  );
  assert.equal(
    (await user("get", "/applications/", "malformed.token.value")).status,
    401,
  );
});

for (const [name, claims] of Object.entries({
  expired: { exp: 1 },
  "missing expiration": { exp: undefined },
  "wrong issuer": { iss: "other-service" },
  "wrong audience": { aud: "other-audience" },
  "future token": { nbf: Math.floor(Date.now() / 1000) + 3600 },
  "refresh token": { token_type: "refresh" },
  "missing token type": { token_type: undefined },
  "missing user id": { user_id: undefined },
  "boolean user id": { user_id: true },
  "fractional user id": { user_id: 42.5 },
  "negative user id": { user_id: -1 },
  "out-of-range user id": { user_id: 2147483648 },
})) {
  test(`rejects a correctly signed token with ${name}`, async () => {
    assert.equal(
      (await user("get", "/applications/", await tokenFor(42, claims))).status,
      401,
    );
  });
}

test("invalid RSA signatures and HMAC algorithm substitution are rejected", async () => {
  const [header, payload, signature] = token.split(".");
  const changed = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(
    (await user("get", "/applications/", `${header}.${payload}.${changed}`))
      .status,
    401,
  );
  const hmacToken = await new SignJWT({ user_id: 42, token_type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("auth-service")
    .setAudience("infraops")
    .setExpirationTime("1h")
    .sign(Buffer.from(harness.config.jwt.publicKey));
  assert.equal((await user("get", "/applications/", hmacToken)).status, 401);
});

test("Django SimpleJWT decimal-string user_id is accepted", async () => {
  const app = await createApplication({}, await tokenFor("42"));
  assert.equal(app.owner_id, 42);
});

test("updates preserve unspecified fields and never execute or invent commands", async () => {
  const app = await createApplication({
    branch: "release/v1",
    run_command: "  node app.js\n",
  });
  const changed = await user("patch", `/applications/${app.id}/`).send({
    port: 8000,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.branch, "release/v1");
  assert.equal(changed.body.run_command, "  node app.js\n");
  const cleared = await user("patch", `/applications/${app.id}/`).send({
    run_command: null,
  });
  assert.equal(cleared.body.run_command, null);
  assert.equal(harness.publisher.calls.length, 0);
});

test("a complete, immutable configuration snapshot is published only after commit", async () => {
  const app = await createApplication({ run_command: "node server.js" });
  harness.publisher.behavior = async (payload) => {
    const stored = await database.query(
      "SELECT request_id FROM build_references WHERE request_id = $1",
      [payload.request_id],
    );
    assert.equal(stored.rows.length, 1);
    await user("patch", `/applications/${app.id}/`).send({
      branch: "changed-after-request",
    });
  };
  const accepted = await trigger(app);
  assert.equal(accepted.status, "QUEUED");
  assert.deepEqual(harness.publisher.calls[0], {
    request_id: accepted.request_id,
    application_id: app.id,
    owner_id: 42,
    name: app.name,
    repository_url: app.repository_url,
    branch: "main",
    application_type: "node",
    source_directory: null,
    requirements_file: null,
    port: 3000,
    run_command: "node server.js",
  });
});

test("build requests accept no body but reject unsupported configuration overrides", async () => {
  const app = await createApplication();
  assert.equal(
    (
      await user("post", `/applications/${app.id}/build/`).send({
        branch: "override",
      })
    ).status,
    400,
  );
  assert.equal(harness.publisher.calls.length, 0);
  assert.equal(
    (await user("post", `/applications/${app.id}/build/`)).status,
    202,
  );
});

test("a rolled-back build transaction never publishes", async () => {
  const app = await createApplication();
  const originalTransaction = database.transaction.bind(database);
  database.transaction = (work) =>
    originalTransaction(async (client) => {
      await work(client);
      throw new Error("Simulated failure before commit");
    });
  try {
    assert.equal(
      (await user("post", `/applications/${app.id}/build/`).send({})).status,
      500,
    );
  } finally {
    database.transaction = originalTransaction;
  }
  assert.equal(harness.publisher.calls.length, 0);
  assert.equal(
    (await user("get", `/applications/${app.id}/builds/`)).body.count,
    0,
  );
});

test("QUEUED and BUILDING both block overlapping requests", async () => {
  const app = await createApplication();
  const first = await trigger(app);
  assert.equal(
    (await user("post", `/applications/${app.id}/build/`).send({})).status,
    409,
  );
  const result = successfulResult(app.id);
  await callback(
    first.request_id,
    {
      build_id: result.build_id,
      application_id: app.id,
      started_at: result.started_at,
    },
    "started",
  );
  assert.equal(
    (await user("post", `/applications/${app.id}/build/`).send({})).status,
    409,
  );
  assert.equal(harness.publisher.calls.length, 1);
});

test("the database independently prevents two active references", async () => {
  const app = await createApplication();
  await trigger(app);
  await assert.rejects(
    database.query(
      "INSERT INTO build_references (application_id, request_id) VALUES ($1, $2)",
      [app.id, randomUUID()],
    ),
    (error) => error.code === "23505",
  );
});

test("definitely-unsent broker failures return 503 and release the active slot", async () => {
  const app = await createApplication();
  harness.publisher.behavior = async () => {
    throw new BuildPublishError(new Error("Connection refused"), false);
  };
  const response = await user("post", `/applications/${app.id}/build/`).send(
    {},
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.error.delivery_uncertain, false);
  const history = (await user("get", `/applications/${app.id}/builds/`)).body
    .results;
  assert.equal(history[0].status, "FAILED");
  assert.equal(history[0].request_id, response.body.error.build_request_id);
  harness.publisher.behavior = null;
  const accepted = await trigger(app);
  assert.notEqual(accepted.request_id, history[0].request_id);
});

test("uncertain publication retains the active slot until a callback reconciles it", async () => {
  const app = await createApplication();
  harness.publisher.behavior = async () => {
    throw new BuildPublishError(new Error("Lost reply"), true);
  };
  const response = await user("post", `/applications/${app.id}/build/`).send(
    {},
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.error.delivery_uncertain, true);
  const history = (await user("get", `/applications/${app.id}/builds/`)).body
    .results;
  assert.equal(history[0].status, "QUEUED");
  assert.equal(history[0].delivery_uncertain, true);
  assert.equal(
    (await user("post", `/applications/${app.id}/build/`).send({})).status,
    409,
  );
  assert.equal(harness.publisher.calls.length, 1);
  const result = successfulResult(app.id);
  const completed = await callback(history[0].request_id, result);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "READY");
  assert.equal(completed.body.delivery_uncertain, false);
});

test("a callback received before publisher failure is not overwritten", async () => {
  const app = await createApplication();
  harness.publisher.behavior = async (payload) => {
    assert.equal(
      (await callback(payload.request_id, successfulResult(app.id))).status,
      200,
    );
    throw new BuildPublishError(new Error("Lost reply"), true);
  };
  const accepted = await trigger(app);
  assert.equal(accepted.status, "READY");
  assert.equal(
    (await user("get", `/applications/${app.id}/`)).body.latest_build_status,
    "READY",
  );
});

test("callbacks require the service secret, not a user JWT", async () => {
  const app = await createApplication();
  const build = await trigger(app);
  const path = `/internal/builds/${build.request_id}/result/`;
  assert.equal(
    (await request(harness.app).post(path).send(successfulResult(app.id)))
      .status,
    401,
  );
  assert.equal(
    (await user("post", path).send(successfulResult(app.id))).status,
    401,
  );
  assert.equal(
    (await callback(randomUUID(), successfulResult(app.id))).status,
    404,
  );
});

test("identical terminal callbacks are no-ops; changed results are conflicts", async () => {
  const app = await createApplication();
  const build = await trigger(app);
  const payload = successfulResult(app.id);
  const first = await callback(build.request_id, payload);
  const duplicate = await callback(build.request_id, {
    ...payload,
    build_id: payload.build_id.toUpperCase(),
    started_at: "2026-11-06T13:00:00+01:00",
  });
  assert.equal(first.status, 200);
  assert.deepEqual(duplicate.body, first.body);
  assert.equal(
    (await callback(build.request_id, { ...payload, image_tag: "different" }))
      .status,
    409,
  );
  const delayed = await callback(
    build.request_id,
    {
      build_id: payload.build_id,
      application_id: app.id,
      started_at: payload.started_at,
    },
    "started",
  );
  assert.equal(delayed.status, 200);
  assert.equal(delayed.body.status, "READY");
});

test("callbacks reject mismatched identities and reuse of another request's build_id", async () => {
  const firstApp = await createApplication();
  const first = await trigger(firstApp);
  const payload = successfulResult(firstApp.id);
  assert.equal(
    (
      await callback(first.request_id, {
        ...payload,
        application_id: firstApp.id + 1,
      })
    ).status,
    409,
  );
  assert.equal((await callback(first.request_id, payload)).status, 200);
  const secondApp = await createApplication({ name: "second-app" });
  const second = await trigger(secondApp);
  const collision = await callback(second.request_id, {
    ...payload,
    application_id: secondApp.id,
  });
  assert.equal(collision.status, 409);
  assert.equal(collision.body.error.code, "build_id_conflict");
  assert.equal(
    (await user("get", `/applications/${secondApp.id}/`)).body
      .latest_build_status,
    "QUEUED",
  );
});

test("failed builds are recorded and a new explicit build can then be requested", async () => {
  const app = await createApplication();
  const first = await trigger(app);
  const failed = {
    build_id: randomUUID(),
    application_id: app.id,
    status: "failed",
    error_message: "Clone failed",
    started_at: "2026-11-06T12:00:00Z",
    finished_at: "2026-11-06T12:01:00Z",
  };
  assert.equal(
    (await callback(first.request_id, failed)).body.status,
    "FAILED",
  );
  const second = await trigger(app);
  const history = await user("get", `/applications/${app.id}/builds/?limit=1`);
  assert.equal(history.body.count, 2);
  assert.equal(history.body.results[0].request_id, second.request_id);
  assert.ok(history.body.next);
});

test("delete removes only local application metadata and reference history", async () => {
  const app = await createApplication();
  const build = await trigger(app);
  assert.equal((await user("delete", `/applications/${app.id}/`)).status, 204);
  assert.equal((await user("get", `/applications/${app.id}/`)).status, 404);
  assert.equal(
    (await database.query("SELECT * FROM build_references")).rows.length,
    0,
  );
  assert.equal(
    (await callback(build.request_id, successfulResult(app.id))).status,
    404,
  );
});

test("rate limits are shared by API instances, return Retry-After, and expire", async () => {
  harness = await createHarness(database, { buildRateLimit: 2 });
  const app = await createApplication();
  const other = await createApplication({ name: "other-app" });
  await trigger(app);
  assert.equal(
    (await user("post", `/applications/${app.id}/build/`).send({})).status,
    409,
  );
  harness = await createHarness(database, { buildRateLimit: 2 });
  const limited = await user("post", `/applications/${other.id}/build/`).send(
    {},
  );
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  await database.query(
    "UPDATE build_throttles SET reset_at = clock_timestamp() - INTERVAL '1 second'",
  );
  await trigger(other);
});

test("health, media-type errors, malformed JSON, and CORS have explicit behavior", async () => {
  assert.equal((await request(harness.app).get("/health/live/")).status, 200);
  assert.equal((await request(harness.app).get("/health/ready/")).status, 200);
  assert.equal(
    (
      await user("post", "/applications/")
        .set("Content-Type", "application/json")
        .send("{")
    ).status,
    400,
  );
  assert.equal(
    (
      await user("post", "/applications/")
        .set("Content-Type", "text/plain")
        .send("hello")
    ).status,
    415,
  );
  assert.equal(
    (await user("post", "/applications/").send({ huge: "a".repeat(40000) }))
      .status,
    413,
  );
  const allowed = await user("get", "/applications/").set(
    "Origin",
    "http://localhost:5173",
  );
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.equal(
    (
      await user("get", "/applications/").set(
        "Origin",
        "https://untrusted.example",
      )
    ).status,
    403,
  );
});

test("database outages do not break liveness or leak connection details", async () => {
  const originalQuery = database.query.bind(database);
  database.query = async () => {
    throw new Error("private-database-connection-details");
  };
  try {
    assert.equal((await request(harness.app).get("/health/live/")).status, 200);
    assert.equal(
      (await request(harness.app).get("/health/ready/")).status,
      503,
    );
    const response = await user("get", "/applications/");
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "internal_error");
    assert.equal(
      JSON.stringify(response.body).includes("private-database"),
      false,
    );
  } finally {
    database.query = originalQuery;
  }
});

test("migrations are repeatable and do not create an Auth Service user table", async () => {
  await migrate(database);
  assert.equal(
    Number(
      (await database.query("SELECT COUNT(*) FROM schema_migrations")).rows[0]
        .count,
    ),
    1,
  );
  assert.equal(
    (
      await database.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename IN ('users', 'auth_user')",
      )
    ).rows.length,
    0,
  );
});

test("real PostgreSQL serializes competing builds from separate API instances", async (context) => {
  if (database.engine !== "postgres")
    return context.skip(
      "Set TEST_DATABASE_URL to exercise real PostgreSQL row locks.",
    );
  const app = await createApplication();
  const sibling = await createHarness(database);
  const responses = await Promise.all([
    user("post", `/applications/${app.id}/build/`).send({}),
    request(sibling.app)
      .post(`/applications/${app.id}/build/`)
      .set("Authorization", `Bearer ${token}`)
      .send({}),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [202, 409],
  );
  assert.equal(
    harness.publisher.calls.length + sibling.publisher.calls.length,
    1,
  );
});
