import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";
import { buildPayload } from "../integrations/build-service/payload.js";
import { BuildPublishError } from "../integrations/build-service/publisher.js";
import { createBuildRepository } from "./repository.js";

export function createBuildService({
  database,
  applications,
  publisher,
  logger = console,
}) {
  const repository = createBuildRepository(database);

  async function getMatchingBuild(requestId, input, client) {
    const build = await repository.find(requestId, client, true);
    if (!build)
      throw new HttpError(404, "build_not_found", "Build request not found.");
    if (
      build.application_id !== input.application_id ||
      (build.build_id && build.build_id !== input.build_id)
    ) {
      throw new HttpError(
        409,
        "build_identity_conflict",
        "The callback does not match this build request.",
      );
    }
    if (build.build_id && build.started_at !== input.started_at) {
      throw new HttpError(
        409,
        "build_timing_conflict",
        "The callback changes the recorded start time.",
      );
    }
    return build;
  }

  return {
    async trigger(applicationId, ownerId) {
      const { build, payload } = await database.transaction(async (client) => {
        const application = await applications.getOwned(
          applicationId,
          ownerId,
          client,
          true,
        );
        if (await repository.hasActive(applicationId, client)) {
          throw new HttpError(
            409,
            "active_build",
            "An active build already exists for this application.",
          );
        }
        const build = await repository.create(
          applicationId,
          randomUUID(),
          client,
        );
        return { build, payload: buildPayload(application, build.request_id) };
      });

      // transaction() resolves only after COMMIT. Nothing is sent for a rolled-back request.
      try {
        await publisher.publish(payload);
      } catch (publishError) {
        logger.warn(
          { build_request_id: build.request_id },
          "Build publication was not confirmed",
        );
        const deliveryUncertain =
          publishError instanceof BuildPublishError
            ? publishError.deliveryUncertain
            : true;
        const current = await repository.recordPublishFailure(
          build.request_id,
          deliveryUncertain,
        );
        if (current?.build_id) {
          // A worker callback can arrive before a lost Redis acknowledgement is detected.
          return {
            request_id: current.request_id,
            application_id: applicationId,
            status: current.status,
          };
        }
        const error = new HttpError(
          503,
          "build_publish_failed",
          "Build submission could not be confirmed. Refresh build history before retrying.",
        );
        error.buildRequestId = build.request_id;
        error.deliveryUncertain = deliveryUncertain;
        throw error;
      }

      return {
        request_id: build.request_id,
        application_id: applicationId,
        status: build.status,
      };
    },

    async list(applicationId, ownerId, pagination) {
      await applications.getOwned(applicationId, ownerId);
      return repository.list(applicationId, pagination);
    },

    started(requestId, input) {
      return database.transaction(async (client) => {
        const build = await getMatchingBuild(requestId, input, client);
        if (build.build_id) return build; // Duplicate or delayed signal must not regress a terminal state.
        return repository.markStarted(requestId, input, client);
      });
    },

    result(requestId, input) {
      return database.transaction(async (client) => {
        const build = await getMatchingBuild(requestId, input, client);
        const expectedStatus = input.status === "success" ? "READY" : "FAILED";
        if (build.build_id && ["READY", "FAILED"].includes(build.status)) {
          const sameResult = Object.entries(input).every(([field, value]) => {
            return field === "status"
              ? build.status === expectedStatus
              : build[field] === value;
          });
          if (!sameResult) {
            throw new HttpError(
              409,
              "build_result_conflict",
              "A different final result is already recorded.",
            );
          }
          return build;
        }

        // A valid callback is authoritative even after a local, uncertain publish failure.
        return repository.finish(requestId, input, client);
      });
    },
  };
}
