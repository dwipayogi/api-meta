import path from "node:path";
import { Router } from "express";
import type { Config } from "../config";
import type { Logger } from "../logger";
import type { MessageRepository } from "../db/repository";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
} from "../middleware/auth";

export function createAuthRouter(deps: {
  config: Config;
  repository: MessageRepository;
  logger: Logger;
}): Router {
  const { config, repository, logger } = deps;
  const router = Router();

  const publicDir = path.join(__dirname, "../../public");

  router.get("/login", async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const verified = verifySessionToken(token, config.sessionSecret);
    if (verified.valid && verified.username) {
      const account = await repository.findAccountByUsername(verified.username);
      if (account) {
        res.redirect("/");
        return;
      }
    }
    res.sendFile(path.join(publicDir, "login.html"));
  });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body ?? {};
    const isJson = req.headers["accept"]?.includes("application/json") || req.is("json");

    if (typeof username === "string" && typeof password === "string") {
      const isValid = await repository.verifyAccountPassword(username, password);
      if (isValid) {
        const token = createSessionToken(username, config.sessionSecret);
        res.cookie(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          secure: config.nodeEnv === "production",
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        logger.info({ username }, "User berhasil login via akun database");
        if (isJson) {
          res.json({ ok: true, redirect: "/" });
        } else {
          res.redirect("/");
        }
        return;
      }
    }

    logger.warn({ ip: req.ip, username }, "Percobaan login gagal");
    if (isJson) {
      res.status(401).json({ error: "Username atau password salah" });
    } else {
      res.redirect("/login?error=1");
    }
  });

  const handleLogout = (_req: any, res: any) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.redirect("/login");
  };

  router.get("/logout", handleLogout);
  router.post("/logout", handleLogout);

  return router;
}
