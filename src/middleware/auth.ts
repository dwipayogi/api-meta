import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Config } from "../config";
import type { MessageRepository } from "../db/repository";
import { safeEqual } from "./verify-signature";

export const SESSION_COOKIE_NAME = "wa_session";

// Hashing password menggunakan scrypt dengan random salt
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derivedKey}`;
}

// Verifikasi password terhadap hash scrypt
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !password) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = parts[1];
  const originalKey = parts[2];
  if (!salt || !originalKey) return false;

  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  const bufOrig = Buffer.from(originalKey, "hex");
  const bufDerived = Buffer.from(derivedKey, "hex");

  if (bufOrig.length !== bufDerived.length) return false;
  return crypto.timingSafeEqual(bufOrig, bufDerived);
}

export function createSessionToken(username: string, secret: string, ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const data = `${username}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return `${data}:${signature}`;
}

export function verifySessionToken(token: string, secret: string): { valid: boolean; username?: string } {
  if (!token) return { valid: false };
  const parts = token.split(":");
  if (parts.length !== 3) return { valid: false };

  const username = parts[0];
  const expiresAtStr = parts[1];
  const signature = parts[2];
  if (!username || !expiresAtStr || !signature) return { valid: false };

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return { valid: false };

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${username}:${expiresAtStr}`)
    .digest("hex");

  if (!safeEqual(signature, expectedSignature)) return { valid: false };
  return { valid: true, username };
}

export function createAuthMiddleware(config: Config, repository: MessageRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const verified = verifySessionToken(token, config.sessionSecret);

    if (verified.valid && verified.username) {
      // Verifikasi bahwa akun terdaftar di database
      const account = await repository.findAccountByUsername(verified.username);
      if (account) {
        (req as any).user = account.username;
        return next();
      }
    }

    if (req.path.startsWith("/api/")) {
      res.status(401).json({ error: "Sesi login tidak valid atau sudah kedaluwarsa" });
      return;
    }

    res.redirect("/login");
  };
}
