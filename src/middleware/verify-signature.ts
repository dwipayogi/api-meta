import crypto from "node:crypto";
import type { NextFunction, Response } from "express";
import type { Logger } from "../logger";
import type { RawBodyRequest } from "../types";

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Sesuai dokumentasi Meta: HMAC-SHA256 dari payload dengan App Secret sebagai key,
// dibandingkan dengan nilai header X-Hub-Signature-256 (bagian setelah "sha256=").
// Wajib dihitung dari raw body (bytes asli), bukan hasil JSON.parse.
export function verifySignature(appSecret: string, logger: Logger) {
  return (req: RawBodyRequest, res: Response, next: NextFunction): void => {
    const header = req.get("x-hub-signature-256") ?? "";
    if (!header.startsWith("sha256=") || !req.rawBody) {
      res.sendStatus(401);
      return;
    }

    const received = header.slice("sha256=".length);
    const expected = crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");

    if (!safeEqual(received, expected)) {
      logger.warn({ ip: req.ip }, "Signature tidak valid");
      res.sendStatus(401);
      return;
    }
    next();
  };
}
