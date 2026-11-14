import { app } from "./app.js";
import {
  checkDatabaseConnection,
  closeDatabase,
  initializeDatabase,
} from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

async function startServer() {
  try {
    await checkDatabaseConnection();
    await initializeDatabase();
    console.log("Connected to PostgreSQL database.");

    const server = app.listen(port, host, () => {
      console.log(`FPGA Test System API is running on http://${host}:${port}`);
    });

    const shutdown = () => {
      server.close(async () => {
        await closeDatabase();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Backend did not start because PostgreSQL is unavailable.");
    console.error(error);
    await closeDatabase();
    process.exitCode = 1;
  }
}

void startServer();
