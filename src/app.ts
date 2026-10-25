import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import type { Config } from "./config";
import type { Logger } from "./logger";
import { type MessageRepository, MemoryMessageRepository } from "./db/repository";
import { createAuthRouter } from "./routes/auth";
import { createDashboardRouter } from "./routes/dashboard";
import { createWebhookRouter } from "./routes/webhook";
import type { PayloadProcessor } from "./services/process-payload";
import type { RawBodyRequest } from "./types";

export interface AppDeps {
  config: Config;
  processPayload: PayloadProcessor;
  logger: Logger;
  repository?: MessageRepository;
}

// App factory: dependency di-inject supaya mudah dites.
export function createApp(deps: AppDeps) {
  const { config, processPayload, logger } = deps;
  const repository = deps.repository ?? new MemoryMessageRepository();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // di belakang reverse proxy (Nginx/Caddy/load balancer)
  
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    })
  );

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  // Simpan raw body: signature harus dihitung dari bytes asli.
  app.use(
    express.json({
      limit: "5mb", // satu POST bisa berisi sampai 1000 update
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    })
  );

  // File statis (CSS, JS, assets) - nonaktifkan index otomatis agar root / lewat proteksi auth
  app.use(express.static(path.join(__dirname, "../public"), { index: false }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Webhook Meta
  app.use("/whatsapp", createWebhookRouter({ config, processPayload, logger, repository }));

  // Rute Auth & Dashboard WhatsApp UI
  app.use(createAuthRouter({ config, repository, logger }));
  app.use(createDashboardRouter({ config, repository, logger }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error({ err }, "Unhandled error");
    res.sendStatus(typeof err?.status === "number" ? err.status : 500);
  };
  app.use(onError);

  return app;
}
