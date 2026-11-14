import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../frontend/dist");

export function serveFrontend(app: Express) {
  if (!existsSync(frontendDist)) return;

  app.use(express.static(frontendDist));
  app.get("/{*splat}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(frontendDist, "index.html"));
  });
}
