import {
  checkDatabaseConnection,
  closeDatabase,
  initializeDatabase,
} from "./db.js";

try {
  await checkDatabaseConnection();
  await initializeDatabase();
  console.log("PostgreSQL tables and seed data are ready.");
} catch (error) {
  console.error("PostgreSQL database setup failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

