import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import multer from "multer";
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

  // Handler 404 untuk endpoint /api yang tidak ditemukan
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint API tidak ditemukan" });
  });

  // Global Error Handling Middleware
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    logger.error(
      {
        err,
        path: req.path,
        method: req.method,
        ip: req.ip,
      },
      "Terjadi error yang belum ditangani (Unhandled Error)"
    );

    // Penanganan khusus error Multer saat upload berkas
    if (err instanceof multer.MulterError || err?.name === "MulterError") {
      let message = "Terjadi kesalahan saat mengunggah berkas";
      let status = 400;

      if (err.code === "LIMIT_FILE_SIZE") {
        message = "Ukuran berkas melebihi batas upload maksimal 30 MB";
        status = 413;
      } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
        message = "Field berkas upload tidak diharapkan atau tidak valid";
        status = 400;
      } else if (err.code === "LIMIT_FILE_COUNT") {
        message = "Jumlah berkas melebihi batas yang diizinkan";
        status = 400;
      }

      res.status(status).json({ error: message, code: err.code });
      return;
    }

    // Penanganan error parsing JSON body
    if (err instanceof SyntaxError && "body" in err && (err as any).status === 400) {
      res.status(400).json({ error: "Format payload request JSON tidak valid atau rusak" });
      return;
    }

    // Penanganan error URI parameter
    if (err instanceof URIError) {
      res.status(400).json({ error: "Parameter URI atau URL encoding tidak valid" });
      return;
    }

    const statusCode =
      typeof err?.status === "number" && err.status >= 400 && err.status < 600
        ? err.status
        : typeof err?.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    const isApiRequest =
      req.path.startsWith("/api") ||
      req.xhr ||
      req.headers.accept?.includes("application/json") ||
      req.is("json");

    if (isApiRequest) {
      const errorMessage =
        err?.message && statusCode < 500
          ? err.message
          : statusCode === 500
          ? "Terjadi kesalahan internal pada server. Silakan coba sesaat lagi."
          : "Permintaan gagal diproses.";
      res.status(statusCode).json({ error: errorMessage });
      return;
    }

    res.sendStatus(statusCode);
  };

  app.use(onError);

  return app;
}
