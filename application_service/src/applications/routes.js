import { Router } from "express";
import {
  applicationIdSchema,
  createApplicationSchema,
  emptyBuildSchema,
  paginationSchema,
  updateApplicationSchema,
} from "./validation.js";

function page(data, { limit, offset }, path) {
  return {
    count: data.count,
    next:
      offset + limit < data.count
        ? `${path}?limit=${limit}&offset=${offset + limit}`
        : null,
    previous:
      offset > 0
        ? `${path}?limit=${limit}&offset=${Math.max(0, offset - limit)}`
        : null,
    results: data.results,
  };
}

export function applicationRoutes({
  applications,
  builds,
  authenticate,
  limitBuilds,
}) {
  const router = Router();
  router.use(authenticate);

  router.post("/", async (request, response) => {
    const input = createApplicationSchema.parse(request.body);
    const application = await applications.create(request.auth.userId, input);
    response
      .status(201)
      .location(`/applications/${application.id}/`)
      .json(application);
  });

  router.get("/", async (request, response) => {
    const pagination = paginationSchema.parse(request.query);
    const data = await applications.list(request.auth.userId, pagination);
    response.json(page(data, pagination, "/applications/"));
  });

  router.get("/:id/", async (request, response) => {
    const id = applicationIdSchema.parse(request.params.id);
    response.json(await applications.getOwned(id, request.auth.userId));
  });

  router.patch("/:id/", async (request, response) => {
    const id = applicationIdSchema.parse(request.params.id);
    const input = updateApplicationSchema.parse(request.body);
    response.json(await applications.update(id, request.auth.userId, input));
  });

  router.delete("/:id/", async (request, response) => {
    const id = applicationIdSchema.parse(request.params.id);
    await applications.remove(id, request.auth.userId);
    response.status(204).end();
  });

  router.post("/:id/build/", limitBuilds, async (request, response) => {
    const id = applicationIdSchema.parse(request.params.id);
    emptyBuildSchema.parse(request.body ?? {});
    const result = await builds.trigger(id, request.auth.userId);
    response.status(202).json(result);
  });

  router.get("/:id/builds/", async (request, response) => {
    const id = applicationIdSchema.parse(request.params.id);
    const pagination = paginationSchema.parse(request.query);
    const data = await builds.list(id, request.auth.userId, pagination);
    response.json(page(data, pagination, `/applications/${id}/builds/`));
  });

  return router;
}
