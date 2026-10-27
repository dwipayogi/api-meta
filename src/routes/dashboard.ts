import path from "node:path";
import { Router } from "express";
import type { Config } from "../config";
import type { Logger } from "../logger";
import type { MessageRepository } from "../db/repository";
import { createAuthMiddleware } from "../middleware/auth";
import { sendMarkAsReadToMeta } from "../services/meta-api";

export function createDashboardRouter(deps: {
  config: Config;
  repository: MessageRepository;
  logger: Logger;
}): Router {
  const { config, repository, logger } = deps;
  const router = Router();
  const requireAuth = createAuthMiddleware(config, repository);

  const publicDir = path.join(__dirname, "../../public");

  // Halaman utama WhatsApp Web View (wajib login)
  router.get("/", requireAuth, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Halaman Log Payload Webhook (wajib login)
  router.get("/logs", requireAuth, (_req, res) => {
    res.sendFile(path.join(publicDir, "logs.html"));
  });

  // API profil admin yang login
  router.get("/api/me", requireAuth, (req, res) => {
    res.json({ username: (req as any).user || "admin" });
  });

  // API ganti password akun di database
  router.post("/api/change-password", requireAuth, async (req, res) => {
    const username = (req as any).user;
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "Password baru harus berupa string minimal 6 karakter" });
      return;
    }

    const isMatch = await repository.verifyAccountPassword(username, currentPassword);
    if (!isMatch) {
      res.status(400).json({ error: "Password saat ini salah" });
      return;
    }

    await repository.updatePassword(username, newPassword);
    logger.info({ username }, "Password akun berhasil diubah di database");
    res.json({ ok: true, message: "Password berhasil diperbarui di database" });
  });

  // API daftar kontak / percakapan
  router.get("/api/conversations", requireAuth, async (_req, res) => {
    try {
      const conversations = await repository.getConversations();
      res.json(conversations);
    } catch (err) {
      logger.error({ err }, "Gagal mengambil daftar percakapan");
      res.status(500).json({ error: "Gagal mengambil data" });
    }
  });

  // API detail pesan untuk satu kontak
  router.get("/api/messages", requireAuth, async (req, res) => {
    const contact = String(req.query.contact || "");
    if (!contact) {
      res.status(400).json({ error: "Parameter contact wajib diisi" });
      return;
    }

    try {
      const messages = await repository.getMessagesByContact(contact);
      res.json(messages);
    } catch (err) {
      logger.error({ err, contact }, "Gagal mengambil pesan untuk kontak");
      res.status(500).json({ error: "Gagal mengambil pesan" });
    }
  });

  // API menandai seluruh pesan percakapan sebagai sudah dibaca + kirim read receipt ke Meta
  router.post("/api/conversations/:contact/read", requireAuth, async (req, res) => {
    const contact = String(req.params.contact || "");
    if (!contact) {
      res.status(400).json({ error: "Parameter contact wajib diisi" });
      return;
    }

    try {
      const updatedMessages = await repository.markConversationAsRead(contact);

      // Meta Cloud API: Pada 1-on-1 chat, menandai pesan terakhir sebagai read
      // otomatis menandai seluruh pesan sebelumnya sebagai terbaca (centang dua biru).
      if (updatedMessages.length > 0) {
        const latestMsg = updatedMessages[updatedMessages.length - 1];
        if (latestMsg) {
          sendMarkAsReadToMeta(config, logger, {
            phoneNumberId: latestMsg.phone_number_id,
            messageId: latestMsg.id,
          }).catch((err) => {
            logger.warn({ err, messageId: latestMsg.id }, "Gagal mengirim mark as read ke Meta Graph API");
          });
        }
      }

      res.json({ ok: true, markedCount: updatedMessages.length });
    } catch (err) {
      logger.error({ err, contact }, "Gagal menandai percakapan sudah dibaca");
      res.status(500).json({ error: "Gagal menandai pesan sudah dibaca" });
    }
  });

  // API menandai percakapan sebagai belum dibaca (set is_read = false pada pesan terakhir)
  router.post("/api/conversations/:contact/unread", requireAuth, async (req, res) => {
    const contact = String(req.params.contact || "");
    if (!contact) {
      res.status(400).json({ error: "Parameter contact wajib diisi" });
      return;
    }

    try {
      const ok = await repository.markConversationAsUnread(contact);
      res.json({ ok });
    } catch (err) {
      logger.error({ err, contact }, "Gagal menandai percakapan belum dibaca");
      res.status(500).json({ error: "Gagal menandai pesan belum dibaca" });
    }
  });

  // API menandai satu pesan tertentu sebagai sudah dibaca
  router.patch("/api/messages/:id/read", requireAuth, async (req, res) => {
    const messageId = String(req.params.id || "");
    if (!messageId) {
      res.status(400).json({ error: "ID pesan wajib diisi" });
      return;
    }

    try {
      const msg = await repository.markMessageAsRead(messageId);
      if (!msg) {
        res.status(404).json({ error: "Pesan tidak ditemukan" });
        return;
      }

      sendMarkAsReadToMeta(config, logger, {
        phoneNumberId: msg.phone_number_id,
        messageId: msg.id,
      }).catch((err) => {
        logger.warn({ err, messageId: msg.id }, "Gagal mengirim mark as read ke Meta Graph API");
      });

      res.json({ ok: true, message: msg });
    } catch (err) {
      logger.error({ err, messageId }, "Gagal menandai pesan sudah dibaca");
      res.status(500).json({ error: "Gagal menandai pesan" });
    }
  });

  // API daftar log payload webhook yang berhasil
  router.get("/api/webhook-logs", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const logs = await repository.getWebhookLogs(limit);
      res.json(logs);
    } catch (err) {
      logger.error({ err }, "Gagal mengambil webhook logs");
      res.status(500).json({ error: "Gagal mengambil webhook logs" });
    }
  });

  // API detail satu log payload webhook
  router.get("/api/webhook-logs/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json({ error: "ID log wajib diisi" });
        return;
      }
      const log = await repository.getWebhookLogById(id);
      if (!log) {
        res.status(404).json({ error: "Log webhook tidak ditemukan" });
        return;
      }
      res.json(log);
    } catch (err) {
      logger.error({ err, id: req.params.id }, "Gagal mengambil detail log webhook");
      res.status(500).json({ error: "Gagal mengambil detail log webhook" });
    }
  });

  return router;
}
