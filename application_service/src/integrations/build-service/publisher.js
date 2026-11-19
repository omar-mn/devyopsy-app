import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import Redis from "ioredis";

export const BUILD_TASK = "builds.start_build";

export class BuildPublishError extends Error {
  constructor(cause, deliveryUncertain) {
    super(cause.message, { cause });
    this.name = "BuildPublishError";
    this.deliveryUncertain = deliveryUncertain;
  }
}

export function celeryEnvelope(payload, queue = "build") {
  const body = [
    [payload],
    {},
    { callbacks: null, errbacks: null, chain: null, chord: null },
  ];

  // Celery protocol v2 inside Kombu's Redis transport envelope, not a raw JSON task.
  return {
    body: Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
    "content-encoding": "utf-8",
    "content-type": "application/json",
    headers: {
      lang: "py",
      task: BUILD_TASK,
      id: payload.request_id,
      root_id: payload.request_id,
      parent_id: null,
      retries: 0,
      ignore_result: true,
      argsrepr: "(<redacted build snapshot>,)",
      kwargsrepr: "{}",
    },
    properties: {
      correlation_id: payload.request_id,
      reply_to: "",
      delivery_mode: 2,
      delivery_info: { exchange: "", routing_key: queue },
      priority: 0,
      body_encoding: "base64",
      // Redis tracks acknowledgements by delivery_tag, so each send needs its own tag.
      delivery_tag: randomUUID(),
    },
  };
}

export function createBuildPublisher({
  redisUrl,
  queue = "build",
  keyPrefix = "",
  timeoutMs = 2000,
  attempts = 3,
  createClient = () =>
    new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      autoResendUnfulfilledCommands: false,
      retryStrategy: null,
      maxRetriesPerRequest: 0,
      connectTimeout: timeoutMs,
      commandTimeout: timeoutMs,
    }),
}) {
  return {
    async publish(payload) {
      const snapshot = structuredClone(payload);
      let lastError;
      let deliveryUncertain = false;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const client = createClient();
        client.on("error", () => {}); // Errors are handled by the awaited operations below.
        let timer;
        let writeStarted = false;
        try {
          const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  "Build publication timed out; delivery is unconfirmed.",
                ),
              );
            }, timeoutMs);
          });
          const send = async () => {
            await client.connect();
            // LPUSH pairs with Kombu's BRPOP. Priority zero uses the unsuffixed queue key.
            writeStarted = true;
            await client.lpush(
              `${keyPrefix}${queue}`,
              JSON.stringify(celeryEnvelope(snapshot, queue)),
            );
          };
          await Promise.race([send(), deadline]);
          return;
        } catch (error) {
          lastError = error;
          if (writeStarted && error.name !== "ReplyError")
            deliveryUncertain = true;
          if (error.name === "ReplyError") break;
        } finally {
          clearTimeout(timer);
          try {
            client.disconnect();
          } catch {
            // Cleanup must not turn an acknowledged publication into a failed one.
          }
        }
        if (attempt + 1 < attempts) await sleep(100 * 2 ** attempt);
      }

      throw new BuildPublishError(lastError, deliveryUncertain);
    },
  };
}
