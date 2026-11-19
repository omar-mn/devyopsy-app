import { Router } from "express";
import { createServiceAuthentication } from "../../auth.js";
import {
  buildResultSchema,
  buildStartedSchema,
  requestIdSchema,
} from "../../applications/validation.js";

export function buildCallbackRoutes(builds, serviceToken) {
  const router = Router();
  router.use(createServiceAuthentication(serviceToken));

  router.post("/:requestId/result/", async (request, response) => {
    const requestId = requestIdSchema.parse(request.params.requestId);
    const result = buildResultSchema.parse(request.body);
    response.json(await builds.result(requestId, result));
  });

  router.post("/:requestId/started/", async (request, response) => {
    const requestId = requestIdSchema.parse(request.params.requestId);
    const result = buildStartedSchema.parse(request.body);
    response.json(await builds.started(requestId, result));
  });

  return router;
}
