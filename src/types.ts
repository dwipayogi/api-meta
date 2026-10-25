import type { Request } from "express";

// Request dengan raw body (dibutuhkan untuk verifikasi signature).
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// Tipe minimal payload webhook WhatsApp. Tambahkan field sesuai kebutuhan:
// https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview#fields
export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  recipient_id?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{ field: string; value?: ChangeValue }>;
  }>;
}
