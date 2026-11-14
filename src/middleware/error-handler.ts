import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  console.error(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";

  if (code === "23505") {
    response.status(409).json({ message: "This test already exists in the selected regression run" });
    return;
  }
  if (code === "23503" || code === "23514" || code === "22P02") {
    response.status(400).json({ message: "The submitted data violates a database constraint" });
    return;
  }
  response.status(500).json({ message: "Internal server error" });
};
