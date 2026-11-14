import { Router } from "express";

import { getCatalog } from "../repositories/catalog.repository.js";

export const catalogRouter = Router();

catalogRouter.get("/", async (_request, response) => {
  response.status(200).json(await getCatalog());
});
