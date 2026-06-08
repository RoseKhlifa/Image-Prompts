import { Hono } from "hono";
import { getStatsSummary } from "../repositories/stats.ts";

const app = new Hono();

app.get("/summary", async (c) => c.json(await getStatsSummary()));

export default app;
