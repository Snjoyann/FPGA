import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadEnvironment({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_DIRECT_URL"),
  },
});
