import { Router } from "express";
import type { Config } from "../config";
import type { Logger } from "../logger";
import { safeEqual, verifySignature } from "../middleware/verify-signature";
import type { PayloadProcessor } from "../services/process-payload";
import type { MessageRepository } from "../db/repository";
import type { RawBodyRequest, WebhookPayload } from "../types";

export function createWebhookRouter(deps: {
  config: Config;
  processPayload: PayloadProcessor;
  logger: Logger;
  repository?: MessageRepository;
}): Router {
  const { config, processPayload, logger, repository } = deps;
  const router = Router();

  // GET: verifikasi endpoint saat Callback URL / Verify token diatur di App Dashboard.
  router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      typeof token === "string" &&
      typeof challenge === "string" &&
      safeEqual(token, config.verifyToken)
    ) {
      logger.info("Webhook terverifikasi");
      res.status(200).type("text/plain").send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  // POST: event notification. Signature wajib valid.
  router.post("/", verifySignature(config.appSecret, logger), async (req: RawBodyRequest, res) => {
    const payload = req.body as WebhookPayload | undefined;

    if (payload?.object !== "whatsapp_business_account") {
      // Signature valid tapi bukan payload untuk kita: ack supaya tidak di-retry.
      res.sendStatus(200);
      return;
    }

    try {
      await processPayload(payload);

      // Simpan log payload ketika webhook berhasil diproses
      if (repository) {
        try {
          const clientIp =
            (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            req.ip ||
            req.socket.remoteAddress ||
            "unknown";

          await repository.saveWebhookLog({
            statusCode: 200,
            ipAddress: clientIp,
            payload,
          });
        } catch (logErr) {
          logger.error({ err: logErr }, "Gagal menyimpan log webhook payload");
        }
      }

      res.sendStatus(200);
    } catch (err) {
      logger.error({ err }, "Gagal memproses event");
      res.sendStatus(500);
    }
  });

  return router;
}
