import fs from "node:fs";
import type { Config } from "../config";
import type { Logger } from "../logger";

export interface MarkAsReadParams {
  phoneNumberId?: string | null;
  messageId: string;
}

export interface MarkAsReadResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: unknown;
  data?: unknown;
}

export interface SendTextMessageParams {
  phoneNumberId?: string | null;
  to: string;
  body: string;
}

export interface SendMediaMessageParams {
  phoneNumberId?: string | null;
  to: string;
  filePath: string;
  mimeType: string;
  filename: string;
  caption?: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  mediaId?: string;
  skipped?: boolean;
  reason?: string;
  error?: unknown;
  data?: unknown;
}

/**
 * Mengirim pesan teks keluar via Meta WhatsApp Cloud API.
 */
export async function sendTextMessageToMeta(
  config: Pick<Config, "metaAccessToken" | "metaApiVersion" | "metaPhoneNumberId">,
  logger: Logger,
  params: SendTextMessageParams
): Promise<SendMessageResult> {
  const token = config.metaAccessToken;
  const phoneNumberId = params.phoneNumberId || config.metaPhoneNumberId;

  if (!token) {
    logger.debug(
      { to: params.to },
      "META_ACCESS_TOKEN tidak diset; pesan keluar disimpan lokal tanpa diposting ke Meta Graph API"
    );
    return { success: false, skipped: true, reason: "META_ACCESS_TOKEN_NOT_CONFIGURED" };
  }

  if (!phoneNumberId) {
    logger.warn(
      { to: params.to },
      "Phone Number ID tidak ditemukan; tidak dapat mengirim pesan via Meta Graph API"
    );
    return { success: false, skipped: true, reason: "PHONE_NUMBER_ID_MISSING" };
  }

  const apiVersion = config.metaApiVersion || "v21.0";
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: "text",
        text: {
          preview_url: false,
          body: params.body,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await res.json().catch(() => null)) as any;

    if (!res.ok) {
      logger.warn(
        { status: res.status, data, to: params.to },
        "Meta Graph API merespons error saat mengirim pesan teks"
      );
      return { success: false, error: data };
    }

    const messageId = data?.messages?.[0]?.id;
    logger.info({ messageId, to: params.to }, "Pesan teks berhasil dikirim via Meta Graph API");
    return { success: true, messageId, data };
  } catch (err) {
    logger.error({ err, to: params.to }, "Gagal menghubungi Meta Graph API untuk pengiriman pesan teks");
    return { success: false, error: err };
  }
}

/**
 * Mengirim pesan file/media keluar via Meta WhatsApp Cloud API.
 * Mengunggah file ke /media terlebih dahulu, lalu mengirim pesan dengan media ID tersebut.
 */
export async function sendMediaMessageToMeta(
  config: Pick<Config, "metaAccessToken" | "metaApiVersion" | "metaPhoneNumberId">,
  logger: Logger,
  params: SendMediaMessageParams
): Promise<SendMessageResult> {
  const token = config.metaAccessToken;
  const phoneNumberId = params.phoneNumberId || config.metaPhoneNumberId;

  if (!token) {
    logger.debug(
      { to: params.to, filename: params.filename },
      "META_ACCESS_TOKEN tidak diset; file disimpan lokal tanpa diunggah ke Meta Graph API"
    );
    return { success: false, skipped: true, reason: "META_ACCESS_TOKEN_NOT_CONFIGURED" };
  }

  if (!phoneNumberId) {
    logger.warn(
      { to: params.to, filename: params.filename },
      "Phone Number ID tidak ditemukan; tidak dapat mengunggah media via Meta Graph API"
    );
    return { success: false, skipped: true, reason: "PHONE_NUMBER_ID_MISSING" };
  }

  const apiVersion = config.metaApiVersion || "v21.0";

  try {
    // 1. Unggah file ke Meta Media API
    const fileBuffer = await fs.promises.readFile(params.filePath);
    const blob = new Blob([fileBuffer], { type: params.mimeType });
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", blob, params.filename);
    formData.append("type", params.mimeType);

    const uploadRes = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30000),
      }
    );

    const uploadData = (await uploadRes.json().catch(() => null)) as any;
    if (!uploadRes.ok || !uploadData?.id) {
      logger.warn(
        { status: uploadRes.status, data: uploadData, filename: params.filename },
        "Meta Media API merespons error saat mengunggah media"
      );
      return { success: false, error: uploadData };
    }

    const mediaId = uploadData.id;

    // 2. Tentukan tipe media WhatsApp
    let mediaType = "document";
    let mediaPayload: Record<string, unknown> = {
      id: mediaId,
      caption: params.caption || undefined,
      filename: params.filename,
    };

    if (params.mimeType.startsWith("image/")) {
      mediaType = "image";
      mediaPayload = { id: mediaId, caption: params.caption || undefined };
    } else if (params.mimeType.startsWith("video/")) {
      mediaType = "video";
      mediaPayload = { id: mediaId, caption: params.caption || undefined };
    } else if (params.mimeType.startsWith("audio/")) {
      mediaType = "audio";
      mediaPayload = { id: mediaId };
    }

    // 3. Kirim pesan media
    const sendRes = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: mediaType,
        [mediaType]: mediaPayload,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const sendData = (await sendRes.json().catch(() => null)) as any;
    if (!sendRes.ok) {
      logger.warn(
        { status: sendRes.status, data: sendData, to: params.to },
        "Meta Graph API merespons error saat mengirim pesan media"
      );
      return { success: false, mediaId, error: sendData };
    }

    const messageId = sendData?.messages?.[0]?.id;
    logger.info(
      { messageId, mediaId, to: params.to, filename: params.filename },
      "Pesan media berhasil dikirim via Meta Graph API"
    );
    return { success: true, messageId, mediaId, data: sendData };
  } catch (err) {
    logger.error(
      { err, to: params.to, filename: params.filename },
      "Gagal menghubungi Meta Graph API untuk pengiriman pesan media"
    );
    return { success: false, error: err };
  }
}

/**
 * Mengirim tanda terima baca (Mark as Read) ke WhatsApp Cloud API.
 * Menandai pesan sebagai 'read' akan memicu tanda centang dua biru di WhatsApp pengirim.
 * Dokumentasi Meta: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/mark-message-as-read
 */
export async function sendMarkAsReadToMeta(
  config: Pick<Config, "metaAccessToken" | "metaApiVersion" | "metaPhoneNumberId">,
  logger: Logger,
  params: MarkAsReadParams
): Promise<MarkAsReadResult> {
  const token = config.metaAccessToken;
  const phoneNumberId = params.phoneNumberId || config.metaPhoneNumberId;

  if (!token) {
    logger.debug(
      { messageId: params.messageId },
      "META_ACCESS_TOKEN tidak diset; lewati pengiriman read receipt ke Meta Graph API"
    );
    return { success: false, skipped: true, reason: "META_ACCESS_TOKEN_NOT_CONFIGURED" };
  }

  if (!phoneNumberId) {
    logger.warn(
      { messageId: params.messageId },
      "Phone Number ID tidak ditemukan; tidak dapat mengirim read receipt ke Meta Graph API"
    );
    return { success: false, skipped: true, reason: "PHONE_NUMBER_ID_MISSING" };
  }

  const apiVersion = config.metaApiVersion || "v21.0";
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: params.messageId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      logger.warn(
        { status: res.status, data, messageId: params.messageId },
        "Meta Graph API merespons error saat menandai pesan sudah dibaca"
      );
      return { success: false, error: data };
    }

    logger.info(
      { messageId: params.messageId, phoneNumberId },
      "Berhasil mengirim status read (centang dua biru) ke Meta Graph API"
    );
    return { success: true, data };
  } catch (err) {
    logger.error(
      { err, messageId: params.messageId, phoneNumberId },
      "Gagal menghubungi Meta Graph API untuk pengiriman read receipt"
    );
    return { success: false, error: err };
  }
}
