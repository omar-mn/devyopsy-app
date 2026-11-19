import { readDatabaseUrl } from "../src/config.js";
import { createDatabase, migrate } from "../src/database.js";

const database = createDatabase(readDatabaseUrl());
try {
  await migrate(database);
  console.info("Database migrations are up to date.");
} finally {
  await database.close();
}
