import { config } from "./config.js";
import { buildServer } from "./server.js";
import { connectRedis, closeRedis } from "./vault.js";
import { connectSessions, closeSessions } from "./sessions.js";
import { bootstrapPlatformAdmin } from "./bootstrap.js";
import { closeDb } from "./db.js";

async function main(): Promise<void> {
  await connectRedis();
  await connectSessions();
  await bootstrapPlatformAdmin();
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeRedis();
    await closeSessions();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`gateway listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("gateway failed to start", err);
  process.exit(1);
});
