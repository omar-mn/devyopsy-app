import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function errorHandler(logger) {
  return (error, request, response, _next) => {
    let problem = error;
    if (error instanceof ZodError) {
      const fields = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "body";
        (fields[key] ??= []).push(issue.message);
      }
      problem = new HttpError(
        400,
        "validation_error",
        "Check the supplied fields.",
        fields,
      );
    } else if (error.type === "entity.parse.failed") {
      problem = new HttpError(
        400,
        "invalid_json",
        "Request body must be valid JSON.",
      );
    } else if (error.type === "entity.too.large") {
      problem = new HttpError(
        413,
        "body_too_large",
        "Request body exceeds 32 KB.",
      );
    } else if (
      ["charset.unsupported", "encoding.unsupported"].includes(error.type)
    ) {
      problem = new HttpError(415, "unsupported_encoding", "Use UTF-8 JSON.");
    } else if (error.code === "23505") {
      const conflicts = {
        unique_app_name_per_owner: [
          "duplicate_name",
          "You already have an application with this name.",
        ],
        one_active_build_per_application: [
          "active_build",
          "An active build already exists for this application.",
        ],
        build_references_build_id_key: [
          "build_id_conflict",
          "This build_id belongs to another build request.",
        ],
      };
      const conflict = conflicts[error.constraint];
      if (conflict) problem = new HttpError(409, ...conflict);
    }

    if (!(problem instanceof HttpError)) {
      // Never log request bodies, bearer tokens, database URLs, or SQL error details.
      logger.error(
        { request_id: request.id, error: error.name, code: error.code },
        "Request failed",
      );
      problem = new HttpError(
        500,
        "internal_error",
        "An unexpected error occurred.",
      );
    }
    if (problem.status === 401) response.set("WWW-Authenticate", "Bearer");
    response.status(problem.status).json({
      error: {
        code: problem.code,
        message: problem.message,
        ...(problem.fields && { fields: problem.fields }),
        ...(problem.buildRequestId && {
          build_request_id: problem.buildRequestId,
        }),
        ...(problem.deliveryUncertain !== undefined && {
          delivery_uncertain: problem.deliveryUncertain,
        }),
        request_id: request.id,
      },
    });
  };
}
