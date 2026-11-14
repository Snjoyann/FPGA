import { app } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabaseConnection, closeDatabase } from "./db.js";

const { port, host } = env;

async function startServer() {
  try {
    await checkDatabaseConnection();
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
