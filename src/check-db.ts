import { checkDatabaseConnection, closeDatabase } from "./database/pool.js";

try {
  await checkDatabaseConnection();
  console.log("PostgreSQL connection is ready.");
} catch (error) {
  console.error("Cannot connect to PostgreSQL.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

