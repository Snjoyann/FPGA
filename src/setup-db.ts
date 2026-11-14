import {
  checkDatabaseConnection,
  closeDatabase,
  initializeDatabase,
} from "./db.js";

try {
  await checkDatabaseConnection();
  await initializeDatabase();
  console.log("PostgreSQL schema is ready. Existing data was not changed.");
} catch (error) {
  console.error("PostgreSQL database setup failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

