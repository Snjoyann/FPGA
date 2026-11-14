import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
config({ path: rootEnvPath, quiet: true });

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing. Configure it in the project root .env file.`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export const env = Object.freeze({
  databaseUrl: requireEnvironmentVariable("DATABASE_URL"),
  databaseDirectUrl: requireEnvironmentVariable("DATABASE_DIRECT_URL"),
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: parsePort(process.env.PORT),
});
