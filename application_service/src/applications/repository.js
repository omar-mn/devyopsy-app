const applicationSelection = `
  SELECT a.*, COALESCE((
    SELECT status FROM build_references
    WHERE application_id = a.id
    ORDER BY created_at DESC, id DESC LIMIT 1
  ), 'NOT_BUILT') AS latest_build_status
  FROM applications a
`;

const mutableColumns = {
  name: "name",
  repository: "repository_url",
  branch: "branch",
  application_type: "application_type",
  source_directory: "source_directory",
  requirements_file: "requirements_file",
  port: "port",
  run_command: "run_command",
};

export function serializeApplication(row) {
  return {
    ...row,
    id: Number(row.id),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    latest_build_status: row.latest_build_status ?? "NOT_BUILT",
  };
}

export function createApplicationRepository(database) {
  return {
    async create(ownerId, input) {
      const fields = Object.keys(mutableColumns);
      const columns = fields.map((field) => mutableColumns[field]);
      const values = [ownerId, ...fields.map((field) => input[field])];
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const { rows } = await database.query(
        `INSERT INTO applications (owner_id, ${columns.join(", ")})
         VALUES (${placeholders.join(", ")}) RETURNING *`,
        values,
      );
      return serializeApplication(rows[0]);
    },

    async findById(id, client = database, lock = false) {
      const { rows } = await client.query(
        `${applicationSelection} WHERE a.id = $1 ${lock ? "FOR UPDATE OF a" : ""}`,
        [id],
      );
      return rows[0] ? serializeApplication(rows[0]) : null;
    },

    async list(ownerId, { limit, offset }) {
      const { rows } = await database.query(
        `${applicationSelection} WHERE a.owner_id = $1
         ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`,
        [ownerId, limit, offset],
      );
      const count = await database.query(
        "SELECT COUNT(*) FROM applications WHERE owner_id = $1",
        [ownerId],
      );
      return {
        results: rows.map(serializeApplication),
        count: Number(count.rows[0].count),
      };
    },

    async update(id, input, client) {
      const fields = Object.keys(input);
      // Column names come only from this fixed map, never from raw client input.
      const assignments = fields.map(
        (field, index) => `${mutableColumns[field]} = $${index + 2}`,
      );
      await client.query(
        `UPDATE applications SET ${assignments.join(", ")}, updated_at = clock_timestamp() WHERE id = $1`,
        [id, ...fields.map((field) => input[field])],
      );
      return this.findById(id, client);
    },

    async remove(id, client) {
      await client.query("DELETE FROM applications WHERE id = $1", [id]);
    },
  };
}
