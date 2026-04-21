import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { migrate } from "../shared/db/migrate.js";
import { syncAll } from "./parser/index.js";
import { refreshPricingFromLiteLLM } from "../shared/pricing.js";
import { startWatcher } from "./parser/watcher.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { statsRoutes } from "./routes/stats.js";
import { memoriesRoutes } from "./routes/memories.js";
import { healthRoutes } from "./routes/health.js";
import { settingsRoutes } from "./routes/settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startServer(port: number = 3200): Promise<void> {
  // Run migrations
  migrate();

  // Fire-and-forget — falls back to hardcoded if fetch fails
  refreshPricingFromLiteLLM().catch(() => undefined);

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Serve static React build if available
  const publicDir = join(__dirname, "public");
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false,
    });
  }

  // API routes
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(statsRoutes, { prefix: "/api" });
  await app.register(memoriesRoutes, { prefix: "/api" });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(settingsRoutes, { prefix: "/api" });

  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler((_req, reply) => {
    const indexPath = join(publicDir, "index.html");
    if (existsSync(indexPath)) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "Not found" });
  });

  // Start JSONL watcher
  startWatcher((event, filePath) => {
    if (event === "synced") {
      console.log(`[watcher] Synced: ${filePath}`);
    }
  });

  // Retry listen with backoff if port in TIME_WAIT
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    try {
      await app.listen({ port, host: "0.0.0.0" });
      break;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" && attempts < maxAttempts - 1) {
        attempts++;
        const delay = Math.min(1000 * Math.pow(2, attempts), 5000);
        console.log(`[ctk] Port ${port} in use, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  // Background sync (fire-and-forget)
  syncAll()
    .then((r) =>
      console.log(`[ctk] Synced ${r.files} files, ${r.sessions} sessions`),
    )
    .catch(console.error);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer().catch((err) => {
    console.error("[ctk] Failed to start server:", err);
    process.exit(1);
  });
}
