import { HttpError } from "../errors.js";

export function createBuildRateLimit(
  database,
  { limit = 10, windowSeconds = 60 } = {},
) {
  return async (request, response, next) => {
    // An atomic UPSERT keeps a user's limit shared across every Node.js API instance.
    const { rows } = await database.query(
      `INSERT INTO build_throttles (owner_id, hits, reset_at)
       VALUES ($1, 1, statement_timestamp() + $2 * INTERVAL '1 second')
       ON CONFLICT (owner_id) DO UPDATE SET
         hits = CASE WHEN build_throttles.reset_at <= statement_timestamp() THEN 1
                     ELSE LEAST(build_throttles.hits + 1, $3 + 1) END,
         reset_at = CASE WHEN build_throttles.reset_at <= statement_timestamp()
                        THEN statement_timestamp() + $2 * INTERVAL '1 second'
                        ELSE build_throttles.reset_at END
       RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - statement_timestamp()))))::INTEGER AS retry_after`,
      [request.auth.userId, windowSeconds, limit],
    );
    if (rows[0].hits > limit) {
      response.set("Retry-After", String(rows[0].retry_after));
      throw new HttpError(
        429,
        "build_rate_limited",
        "Too many build requests. Try again later.",
      );
    }
    next();
  };
}
