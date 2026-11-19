import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

export function createDatabase(connectionString, options = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 10000,
    ...options,
  });
  pool.on("error", (error) => {
    console.error("Idle database connection failed", { code: error.code });
  });

  return {
    query: (text, values) => pool.query(text, values),
    async transaction(work) {
      const client = await pool.connect();
      let releaseError;
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          releaseError = rollbackError;
        }
        throw error;
      } finally {
        client.release(releaseError);
      }
    },
    close: () => pool.end(),
  };
}

export async function migrate(database) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  await database.transaction(async (client) => {
    // Serialize migrations when several instances are being deployed together.
    await client.query("SELECT pg_advisory_xact_lock(73400321)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const { rows } = await client.query(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const name of files) {
      const sql = (await readFile(new URL(name, directory), "utf8")).replaceAll(
        "\r\n",
        "\n",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) {
          throw new Error(
            `Applied migration ${name} was changed. Add a new migration instead.`,
          );
        }
        continue;
      }
      // SQL batches use pg's query(), or exec() in the PGlite test engine.
      if (client.exec) await client.exec(sql);
      else await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
    }
  });
}
