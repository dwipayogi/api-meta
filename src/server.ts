import { createApp } from "./app";
import { loadConfig } from "./config";
import { createRepository } from "./db";
import { createLogger } from "./logger";
import { createMemoryDedup } from "./services/dedup";
import { createHandlers } from "./services/handlers";
import { createPayloadProcessor } from "./services/process-payload";

async function bootstrap() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel, config.nodeEnv);
  const repository = await createRepository(config, logger);
  const dedup = createMemoryDedup();
  const handlers = createHandlers(logger, repository);
  const processPayload = createPayloadProcessor({ dedup, handlers });
  const app = createApp({ config, processPayload, logger, repository });

  const server = app.listen(config.port, () =>
    logger.info(`Server berjalan di http://localhost:${config.port}`)
  );

  // Lebih panjang dari idle timeout load balancer (umumnya 60 detik)
  // supaya koneksi tidak diputus di tengah request.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} diterima, shutting down`);

    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      dedup.stop();
      try {
        await repository.close();
      } catch (err) {
        logger.error({ err }, "Error saat menutup database repository");
      }
      process.exit(0);
    });
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => shutdown(sig));
  }
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
