import express from "express";

import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { serveFrontend } from "./middleware/frontend.js";
import { analyticsRouter } from "./routes/analytics.routes.js";
import { catalogRouter } from "./routes/catalog.routes.js";
import { testRunRouter } from "./routes/test-run.routes.js";

export const app = express();

app.use(express.json({ limit: "256kb" }));
app.use(corsMiddleware);
app.options("*splat", (_request, response) => response.sendStatus(204));

app.get("/api/health", (_request, response) => {
  response.status(200).json({ status: "ok", service: "fpga-test-system" });
});
app.use("/api/catalog", catalogRouter);
app.use("/api/test-runs", testRunRouter);
app.use("/api", analyticsRouter);

serveFrontend(app);
app.use(errorHandler);
