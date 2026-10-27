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
