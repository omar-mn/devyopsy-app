import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createUserAuthentication } from "./auth.js";
import { HttpError, errorHandler } from "./errors.js";
import { applicationRoutes } from "./applications/routes.js";
import { createApplicationService } from "./applications/service.js";
import { createBuildRateLimit } from "./builds/rate-limit.js";
import { createBuildService } from "./builds/service.js";
import { buildCallbackRoutes } from "./integrations/build-service/callbacks.js";

export async function createApp({
  database,
  publisher,
  config,
  logger = console,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((request, response, next) => {
    request.id = randomUUID();
    response.set("X-Request-Id", request.id);
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin))
          callback(null, true);
        else
          callback(
            new HttpError(
              403,
              "origin_not_allowed",
              "This browser origin is not allowed.",
            ),
          );
      },
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
    }),
  );
  app.use((request, _response, next) => {
    const hasBody =
      request.get("transfer-encoding") ||
      Number(request.get("content-length")) > 0;
    if (
      hasBody &&
      ["POST", "PATCH"].includes(request.method) &&
      !request.is("application/json")
    ) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Use Content-Type: application/json.",
      );
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.get("/health/live/", (_request, response) =>
    response.json({ status: "ok" }),
  );
  app.get("/health/ready/", async (_request, response) => {
    try {
      await database.query("SELECT 1");
    } catch {
      throw new HttpError(
        503,
        "database_unavailable",
        "The database is unavailable.",
      );
    }
    response.json({ status: "ok", database: "ok" });
  });

  const applications = createApplicationService(database);
  const builds = createBuildService({
    database,
    applications,
    publisher,
    logger,
  });
  const authenticate = await createUserAuthentication(config.jwt);
  const limitBuilds = createBuildRateLimit(database, {
    limit: config.buildRateLimit,
    windowSeconds: config.buildRateWindowSeconds,
  });
  app.use(
    "/applications",
    applicationRoutes({ applications, builds, authenticate, limitBuilds }),
  );
  app.use(
    "/internal/builds",
    buildCallbackRoutes(builds, config.buildServiceToken),
  );

  app.use(() => {
    throw new HttpError(404, "not_found", "Endpoint not found.");
  });
  app.use(errorHandler(logger));
  return app;
}
