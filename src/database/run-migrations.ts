import { migrateDatabase } from "./migrator.js";

try {
  const { applied, total } = await migrateDatabase();
  if (applied.length === 0) {
    console.log(`Database migrations are up to date (${total} verified).`);
  } else {
    console.log(`Applied ${applied.length} migration(s): ${applied.join(", ")}`);
  }
} catch (error) {
  console.error("Database migration failed.");
  console.error(error);
  process.exitCode = 1;
}
