import { Router } from "express";

import { compareRegressionRuns, getDashboard } from "../repositories/analytics.repository.js";
import { parsePositiveId } from "../shared/http/params.js";

export const analyticsRouter = Router();

analyticsRouter.get("/dashboard", async (request, response) => {
  const regressionRunId = request.query.regressionRunId
    ? (parsePositiveId(String(request.query.regressionRunId)) ?? undefined)
    : undefined;
  if (request.query.regressionRunId && !regressionRunId) {
    return response.status(400).json({ message: "regressionRunId must be a positive integer" });
  }
  return response.status(200).json(await getDashboard(regressionRunId));
});

analyticsRouter.get("/compare", async (request, response) => {
  const leftId = parsePositiveId(String(request.query.left ?? ""));
  const rightId = parsePositiveId(String(request.query.right ?? ""));
  if (!leftId || !rightId || leftId === rightId) {
    return response.status(400).json({
      message: "left and right must be different positive regression run IDs",
    });
  }

  const comparison = await compareRegressionRuns(leftId, rightId);
  if (!comparison) {
    return response.status(404).json({ message: "One or both regression runs were not found" });
  }
  return response.status(200).json(comparison);
});
