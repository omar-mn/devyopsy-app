import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { createBuildPublisher } from "./integrations/build-service/publisher.js";

const config = await loadConfig();
const database = createDatabase(config.databaseUrl);
const publisher = createBuildPublisher({
  redisUrl: config.redisUrl,
  queue: config.buildQueue,
  keyPrefix: config.celeryKeyPrefix,
  timeoutMs: config.publishTimeoutMs,
  attempts: config.publishAttempts,
});

try {
  await database.query("SELECT 1");
  const app = await createApp({ database, publisher, config });
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.info(`Application Service listening on port ${config.port}`);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    server.close(async () => {
      try {
        await database.close();
        clearTimeout(deadline);
      } catch {
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  await database.close();
  throw error;
}
