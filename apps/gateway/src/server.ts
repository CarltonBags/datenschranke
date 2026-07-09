import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { query } from "./db.js";
import { healthy as redactorHealthy } from "./redactorClient.js";
import { openaiChatRoutes } from "./routes/openaiChat.js";
import { productARoutes } from "./routes/productA.js";
import { adminRoutes } from "./routes/admin.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Never log request/response bodies (they may contain PII pre-redaction).
      redact: { paths: ["req.body", "res.body", "req.headers.authorization"], remove: true },
    },
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, { origin: true, exposedHeaders: ["x-conversation-id"] });

  app.get("/healthz", async (_req, reply) => {
    const [dbOk, redOk] = await Promise.all([
      query("SELECT 1").then(() => true).catch(() => false),
      redactorHealthy(),
    ]);
    const ok = dbOk && redOk;
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", db: dbOk, redactor: redOk });
  });

  await app.register(openaiChatRoutes);
  await app.register(productARoutes);
  await app.register(adminRoutes);

  return app;
}
