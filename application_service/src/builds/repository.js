export function serializeBuild(row) {
  return {
    request_id: row.request_id,
    build_id: row.build_id,
    application_id: Number(row.application_id),
    status: row.status,
    delivery_uncertain: row.delivery_uncertain,
    image_repository: row.image_repository,
    image_tag: row.image_tag,
    image_digest: row.image_digest,
    commit_sha: row.commit_sha,
    error_message: row.error_message,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    finished_at: row.finished_at
      ? new Date(row.finished_at).toISOString()
      : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export function createBuildRepository(database) {
  return {
    async hasActive(applicationId, client) {
      const { rows } = await client.query(
        "SELECT 1 FROM build_references WHERE application_id = $1 AND status IN ('QUEUED', 'BUILDING') LIMIT 1",
        [applicationId],
      );
      return rows.length > 0;
    },

    async create(applicationId, requestId, client) {
      const { rows } = await client.query(
        "INSERT INTO build_references (application_id, request_id) VALUES ($1, $2) RETURNING *",
        [applicationId, requestId],
      );
      return serializeBuild(rows[0]);
    },

    async find(requestId, client = database, lock = false) {
      const { rows } = await client.query(
        `SELECT * FROM build_references WHERE request_id = $1 ${lock ? "FOR UPDATE" : ""}`,
        [requestId],
      );
      return rows[0] ? serializeBuild(rows[0]) : null;
    },

    async recordPublishFailure(requestId, deliveryUncertain) {
      await database.query(
        `UPDATE build_references SET
         status = CASE WHEN $2 THEN 'QUEUED' ELSE 'FAILED' END,
         delivery_uncertain = $2,
         finished_at = CASE WHEN $2 THEN NULL ELSE clock_timestamp() END,
         error_message = CASE WHEN $2 THEN 'Build delivery is unconfirmed. Await reconciliation before retrying.'
                              ELSE 'Build request could not be submitted.' END
         WHERE request_id = $1 AND status = 'QUEUED' AND build_id IS NULL`,
        [requestId, deliveryUncertain],
      );
      return this.find(requestId);
    },

    async markStarted(requestId, input, client) {
      const { rows } = await client.query(
        `UPDATE build_references SET build_id = $2, status = 'BUILDING', started_at = $3, delivery_uncertain = FALSE,
         finished_at = NULL, error_message = NULL WHERE request_id = $1 RETURNING *`,
        [requestId, input.build_id, input.started_at],
      );
      return serializeBuild(rows[0]);
    },

    async finish(requestId, input, client) {
      const { rows } = await client.query(
        `UPDATE build_references SET build_id = $2, status = $3, delivery_uncertain = FALSE, image_repository = $4,
         image_tag = $5, image_digest = $6, commit_sha = $7, error_message = $8,
         started_at = $9, finished_at = $10 WHERE request_id = $1 RETURNING *`,
        [
          requestId,
          input.build_id,
          input.status === "success" ? "READY" : "FAILED",
          input.image_repository,
          input.image_tag,
          input.image_digest,
          input.commit_sha,
          input.error_message,
          input.started_at,
          input.finished_at,
        ],
      );
      return serializeBuild(rows[0]);
    },

    async list(applicationId, { limit, offset }) {
      const { rows } = await database.query(
        `SELECT * FROM build_references WHERE application_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [applicationId, limit, offset],
      );
      const count = await database.query(
        "SELECT COUNT(*) FROM build_references WHERE application_id = $1",
        [applicationId],
      );
      return {
        count: Number(count.rows[0].count),
        results: rows.map(serializeBuild),
      };
    },
  };
}
