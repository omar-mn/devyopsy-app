import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  celeryEnvelope,
  createBuildPublisher,
} from "../src/integrations/build-service/publisher.js";

const payload = {
  request_id: randomUUID(),
  application_id: 1,
  run_command: "printf '\u03bb'",
  source_directory: null,
};

class FakeRedis extends EventEmitter {
  writes = [];
  disconnected = false;
  async connect() {}
  async lpush(key, value) {
    this.writes.push({ key, value });
  }
  disconnect() {
    this.disconnected = true;
  }
}

test("Celery v2 body has one positional snapshot and a complete Kombu envelope", () => {
  const message = celeryEnvelope(payload);
  assert.deepEqual(
    JSON.parse(Buffer.from(message.body, "base64").toString("utf8")),
    [
      [payload],
      {},
      { callbacks: null, errbacks: null, chain: null, chord: null },
    ],
  );
  assert.equal(message["content-type"], "application/json");
  assert.equal(message["content-encoding"], "utf-8");
  assert.equal(message.headers.lang, "py");
  assert.equal(message.headers.task, "builds.start_build");
  assert.equal(message.headers.id, payload.request_id);
  assert.equal(message.properties.correlation_id, payload.request_id);
  assert.deepEqual(message.properties.delivery_info, {
    exchange: "",
    routing_key: "build",
  });
  assert.equal(message.properties.priority, 0);
  assert.equal(message.headers.ignore_result, true);
  assert.equal(message.properties.body_encoding, "base64");
  assert.notEqual(
    celeryEnvelope(payload).properties.delivery_tag,
    message.properties.delivery_tag,
  );
});

test("publisher LPUSHes to the prefixed physical queue but keeps the logical routing key", async () => {
  const client = new FakeRedis();
  const publisher = createBuildPublisher({
    createClient: () => client,
    keyPrefix: "infraops:",
    queue: "build",
  });
  await publisher.publish(payload);
  assert.equal(client.writes[0].key, "infraops:build");
  assert.equal(
    JSON.parse(client.writes[0].value).properties.delivery_info.routing_key,
    "build",
  );
  assert.equal(client.disconnected, true);
});

test("explicit retries preserve request identity and snapshot but use new delivery tags", async () => {
  const clients = [];
  const input = structuredClone(payload);
  const publisher = createBuildPublisher({
    attempts: 2,
    createClient() {
      const client = new FakeRedis();
      if (clients.length === 0)
        client.lpush = async (key, value) => {
          client.writes.push({ key, value });
          input.run_command = "changed by caller";
          throw new Error("Connection reset after write");
        };
      clients.push(client);
      return client;
    },
  });
  await publisher.publish(input);
  const [first, second] = clients.map((client) =>
    JSON.parse(client.writes[0].value),
  );
  assert.equal(first.body, second.body);
  assert.equal(first.headers.id, second.headers.id);
  assert.notEqual(
    first.properties.delivery_tag,
    second.properties.delivery_tag,
  );
  assert.ok(clients.every((client) => client.disconnected));
});

test("a non-responding broker is disconnected on the complete attempt deadline", async () => {
  const client = new FakeRedis();
  client.lpush = () => new Promise(() => {});
  const publisher = createBuildPublisher({
    createClient: () => client,
    timeoutMs: 25,
    attempts: 1,
  });
  await assert.rejects(
    publisher.publish(payload),
    (error) => error.deliveryUncertain && /timed out/.test(error.message),
  );
  assert.equal(client.disconnected, true);
});

test("connection failures before a write are definitely unsent", async () => {
  const client = new FakeRedis();
  client.connect = async () => {
    throw new Error("Connection refused");
  };
  const publisher = createBuildPublisher({
    createClient: () => client,
    attempts: 1,
  });
  await assert.rejects(
    publisher.publish(payload),
    (error) => error.deliveryUncertain === false,
  );
  assert.equal(client.writes.length, 0);
});

test("a later failed connection does not erase an earlier uncertain write", async () => {
  let attempts = 0;
  const publisher = createBuildPublisher({
    attempts: 2,
    createClient() {
      const client = new FakeRedis();
      if (attempts++ === 0)
        client.lpush = async () => {
          throw new Error("Lost acknowledgement");
        };
      else
        client.connect = async () => {
          throw new Error("Connection refused");
        };
      return client;
    },
  });
  await assert.rejects(
    publisher.publish(payload),
    (error) => error.deliveryUncertain === true,
  );
  assert.equal(attempts, 2);
});

test("Redis reply errors are not blindly retried", async () => {
  let connections = 0;
  const publisher = createBuildPublisher({
    attempts: 3,
    createClient() {
      connections += 1;
      const client = new FakeRedis();
      client.lpush = async () => {
        const error = new Error("WRONGTYPE");
        error.name = "ReplyError";
        throw error;
      };
      return client;
    },
  });
  await assert.rejects(publisher.publish(payload), /WRONGTYPE/);
  assert.equal(connections, 1);
});

test("cleanup errors cannot negate an acknowledged publication", async () => {
  const client = new FakeRedis();
  client.disconnect = () => {
    throw new Error("cleanup failure");
  };
  await createBuildPublisher({ createClient: () => client }).publish(payload);
  assert.equal(client.writes.length, 1);
});
