import type { Pool } from "pg";
import type { ChangeValue, WhatsAppMessage, WhatsAppStatus } from "../types";
import { hashPassword, verifyPassword } from "../middleware/auth";

export interface Account {
  id: string | number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  from_number: string;
  to_number?: string | null;
  phone_number_id?: string | null;
  contact_wa_id?: string | null;
  contact_name?: string | null;
  message_type: string;
  body: string;
  timestamp: string; // ISO string
  status: string;
  is_read: boolean;
  read_at?: string | null;
  direction?: "inbound" | "outbound";
  media_url?: string | null;
  raw_payload: unknown;
  created_at: string;
}

export interface SaveOutboundMessageInput {
  id?: string;
  toNumber: string;
  fromNumber?: string;
  phoneNumberId?: string | null;
  contactWaId: string;
  contactName?: string | null;
  messageType: string;
  body: string;
  mediaUrl?: string | null;
  status?: string;
  rawPayload?: unknown;
}

export interface ConversationSummary {
  contact_identifier: string;
  contact_name: string;
  from_number: string;
  last_message: string;
  last_timestamp: string;
  message_count: number;
  unread_count: number;
}

export interface WebhookLogItem {
  id: string | number;
  status_code: number;
  ip_address: string;
  object_type: string;
  entry_count: number;
  payload: unknown;
  created_at: string;
}

export interface SaveWebhookLogInput {
  statusCode: number;
  ipAddress: string;
  payload: unknown;
}

export interface MessageRepository {
  init(): Promise<void>;
  
  // Akun & Autentikasi
  createAccount(username: string, password: string): Promise<Account>;
  findAccountByUsername(username: string): Promise<Account | null>;
  verifyAccountPassword(username: string, password: string): Promise<boolean>;
  updatePassword(username: string, newPassword: string): Promise<boolean>;

  // Pesan & Kontak
  saveIncomingMessage(msg: WhatsAppMessage, value: ChangeValue): Promise<void>;
  saveStatus(status: WhatsAppStatus, value: ChangeValue): Promise<void>;
  getConversations(): Promise<ConversationSummary[]>;
  getMessagesByContact(identifier: string): Promise<StoredMessage[]>;
  markConversationAsRead(identifier: string): Promise<StoredMessage[]>;
  markConversationAsUnread(identifier: string): Promise<boolean>;
  markMessageAsRead(messageId: string): Promise<StoredMessage | null>;
  saveOutboundMessage(input: SaveOutboundMessageInput): Promise<StoredMessage>;
  
  // Log Webhook
  saveWebhookLog(input: SaveWebhookLogInput): Promise<void>;
  getWebhookLogs(limit?: number): Promise<WebhookLogItem[]>;
  getWebhookLogById(id: string | number): Promise<WebhookLogItem | null>;
  
  close(): Promise<void>;
}

export function parseTimestamp(ts: string | number | undefined): Date {
  if (!ts) return new Date();
  const num = typeof ts === "string" ? parseInt(ts, 10) : ts;
  if (isNaN(num)) return new Date();
  // WhatsApp timestamp berupa unix seconds
  return new Date(num * 1000);
}

export function extractMessageBody(msg: WhatsAppMessage): string {
  switch (msg.type) {
    case "text":
      return typeof msg.text === "object" && msg.text && "body" in msg.text
        ? String(msg.text.body)
        : "";
    case "image": {
      const img = msg.image as { caption?: string } | undefined;
      return img?.caption ? `📷 ${img.caption}` : "📷 [Gambar]";
    }
    case "document": {
      const doc = msg.document as { filename?: string; caption?: string } | undefined;
      return `📄 ${doc?.filename || "[Dokumen]"}${doc?.caption ? ` - ${doc.caption}` : ""}`;
    }
    case "audio":
      return "🎵 [Pesan Suara]";
    case "video": {
      const vid = msg.video as { caption?: string } | undefined;
      return vid?.caption ? `🎥 ${vid.caption}` : "🎥 [Video]";
    }
    case "location": {
      const loc = msg.location as { name?: string; latitude?: number; longitude?: number } | undefined;
      return `📍 ${loc?.name ? loc.name + " " : ""}(${loc?.latitude}, ${loc?.longitude})`;
    }
    case "interactive": {
      const inter = msg.interactive as {
        button_reply?: { title?: string };
        list_reply?: { title?: string };
      } | undefined;
      return inter?.button_reply?.title || inter?.list_reply?.title || "🔘 [Interaktif]";
    }
    case "button": {
      const btn = msg.button as { text?: string } | undefined;
      return btn?.text || "🔘 [Tombol]";
    }
    case "reaction": {
      const r = msg.reaction as { emoji?: string } | undefined;
      return `[Reaksi: ${r?.emoji || ""}]`;
    }
    default:
      return `[${msg.type || "Pesan"}]`;
  }
}

export class PgMessageRepository implements MessageRepository {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

      CREATE TABLE IF NOT EXISTS contacts (
        wa_id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255),
        phone_number VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        from_number VARCHAR(64) NOT NULL,
        to_number VARCHAR(64),
        phone_number_id VARCHAR(64),
        contact_wa_id VARCHAR(64) REFERENCES contacts(wa_id) ON DELETE SET NULL,
        contact_name VARCHAR(255),
        message_type VARCHAR(64) NOT NULL,
        body TEXT,
        timestamp TIMESTAMPTZ NOT NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'received',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        direction VARCHAR(16) NOT NULL DEFAULT 'inbound',
        media_url TEXT,
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_from_number ON messages(from_number);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_contact_wa_id ON messages(contact_wa_id);

      -- Auto-migrasi kolom is_read, read_at, direction, media_url jika tabel sudah ada sebelumnya
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'inbound';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_contact_is_read ON messages(contact_wa_id, is_read);

      CREATE TABLE IF NOT EXISTS message_statuses (
        id BIGSERIAL PRIMARY KEY,
        message_id VARCHAR(255) NOT NULL,
        status VARCHAR(64) NOT NULL,
        recipient_id VARCHAR(64),
        timestamp TIMESTAMPTZ,
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_message_statuses_message_id ON message_statuses(message_id);

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id BIGSERIAL PRIMARY KEY,
        status_code INT NOT NULL DEFAULT 200,
        ip_address VARCHAR(64),
        object_type VARCHAR(64),
        entry_count INT DEFAULT 1,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);
    `);

    // Inisialisasi akun admin pertama di DB jika tabel masih kosong
    const countRes = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM accounts"
    );
    if (Number(countRes.rows[0]?.count) === 0) {
      const defaultUser = process.env.INITIAL_ADMIN_USERNAME || "admin";
      const defaultPass = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
      await this.createAccount(defaultUser, defaultPass);
    }
  }

  async createAccount(username: string, password: string): Promise<Account> {
    const passwordHash = hashPassword(password);
    const result = await this.pool.query<Account>(
      `INSERT INTO accounts (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, password_hash, created_at, updated_at`,
      [username, passwordHash]
    );
    const row = result.rows[0]!;
    return {
      ...row,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async findAccountByUsername(username: string): Promise<Account | null> {
    const result = await this.pool.query<Account>(
      `SELECT id, username, password_hash, created_at, updated_at
       FROM accounts
       WHERE username = $1`,
      [username]
    );
    if (!result.rows.length || !result.rows[0]) return null;
    const row = result.rows[0];
    return {
      ...row,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async verifyAccountPassword(username: string, password: string): Promise<boolean> {
    const account = await this.findAccountByUsername(username);
    if (!account) return false;
    return verifyPassword(password, account.password_hash);
  }

  async updatePassword(username: string, newPassword: string): Promise<boolean> {
    const newHash = hashPassword(newPassword);
    const result = await this.pool.query(
      `UPDATE accounts
       SET password_hash = $1, updated_at = NOW()
       WHERE username = $2`,
      [newHash, username]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async saveIncomingMessage(msg: WhatsAppMessage, value: ChangeValue): Promise<void> {
    const contact = value.contacts?.find((c) => c.wa_id === msg.from) ?? value.contacts?.[0];
    const contactWaId = contact?.wa_id ?? msg.from;
    const contactName = contact?.profile?.name ?? msg.from;
    const toNumber = value.metadata?.display_phone_number ?? null;
    const phoneNumberId = value.metadata?.phone_number_id ?? null;
    const body = extractMessageBody(msg);
    const timestamp = parseTimestamp(msg.timestamp);

    // 1. Simpan / perbarui kontak
    await this.pool.query(
      `INSERT INTO contacts (wa_id, name, phone_number, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wa_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, contacts.name),
         phone_number = COALESCE(EXCLUDED.phone_number, contacts.phone_number),
         updated_at = NOW()`,
      [contactWaId, contactName, msg.from]
    );

    // 2. Simpan pesan (idempotent ON CONFLICT)
    await this.pool.query(
      `INSERT INTO messages (
         id, from_number, to_number, phone_number_id,
         contact_wa_id, contact_name, message_type,
         body, timestamp, status, is_read, raw_payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', FALSE, $10
       ) ON CONFLICT (id) DO UPDATE SET
         body = EXCLUDED.body,
         status = EXCLUDED.status,
         raw_payload = EXCLUDED.raw_payload`,
      [
        msg.id,
        msg.from,
        toNumber,
        phoneNumberId,
        contactWaId,
        contactName,
        msg.type ?? "unknown",
        body,
        timestamp,
        JSON.stringify({ msg, value }),
      ]
    );
  }

  async saveStatus(status: WhatsAppStatus, value: ChangeValue): Promise<void> {
    const timestamp = parseTimestamp(status.timestamp);

    await this.pool.query(
      `INSERT INTO message_statuses (message_id, status, recipient_id, timestamp, raw_payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        status.id,
        status.status,
        status.recipient_id ?? null,
        timestamp,
        JSON.stringify({ status, value }),
      ]
    );

    await this.pool.query(`UPDATE messages SET status = $1 WHERE id = $2`, [
      status.status,
      status.id,
    ]);
  }

  async getConversations(): Promise<ConversationSummary[]> {
    const result = await this.pool.query<{
      contact_identifier: string;
      contact_name: string;
      from_number: string;
      last_message: string;
      last_timestamp: string;
      message_count: number;
      unread_count: number;
    }>(`
      -- Pesan terakhir diambil lewat CTE terpisah (DISTINCT ON), bukan subquery
      -- korelasi di dalam GROUP BY: Postgres menolak subquery yang memakai kolom
      -- luar yang tidak di-group (error 42803).
      WITH base AS (
        SELECT m.*, COALESCE(m.contact_wa_id, m.from_number) AS contact_identifier
        FROM messages m
      ),
      agg AS (
        SELECT
          b.contact_identifier,
          COALESCE(MAX(c.name), MAX(b.contact_name), b.contact_identifier) AS contact_name,
          COALESCE(MAX(c.phone_number), MAX(CASE WHEN b.direction != 'outbound' THEN b.from_number END), MAX(b.to_number), b.contact_identifier) AS from_number,
          MAX(b.timestamp) AS last_timestamp,
          COUNT(b.id)::int AS message_count,
          COUNT(CASE WHEN b.is_read = FALSE THEN 1 END)::int AS unread_count
        FROM base b
        LEFT JOIN contacts c ON c.wa_id = b.contact_wa_id
        GROUP BY b.contact_identifier
      ),
      latest AS (
        SELECT DISTINCT ON (contact_identifier) contact_identifier, body
        FROM base
        ORDER BY contact_identifier, timestamp DESC, created_at DESC
      )
      SELECT
        a.contact_identifier,
        a.contact_name,
        a.from_number,
        l.body AS last_message,
        a.last_timestamp,
        a.message_count,
        a.unread_count
      FROM agg a
      LEFT JOIN latest l ON l.contact_identifier = a.contact_identifier
      ORDER BY a.last_timestamp DESC;
    `);

    return result.rows.map((row) => ({
      contact_identifier: row.contact_identifier,
      contact_name: row.contact_name || row.from_number,
      from_number: row.from_number,
      last_message: row.last_message || "",
      last_timestamp: row.last_timestamp ? new Date(row.last_timestamp).toISOString() : "",
      message_count: Number(row.message_count) || 0,
      unread_count: Number(row.unread_count) || 0,
    }));
  }

  async getMessagesByContact(identifier: string): Promise<StoredMessage[]> {
    const result = await this.pool.query<any>(
      `SELECT 
         id,
         from_number,
         to_number,
         phone_number_id,
         contact_wa_id,
         contact_name,
         message_type,
         body,
         timestamp,
         status,
         is_read,
         read_at,
         direction,
         media_url,
         raw_payload,
         created_at
       FROM messages
       WHERE contact_wa_id = $1 OR from_number = $1 OR to_number = $1
       ORDER BY timestamp ASC, created_at ASC`,
      [identifier]
    );

    return result.rows.map((row) => ({
      ...row,
      direction: row.direction || (row.from_number === "me" ? "outbound" : "inbound"),
      media_url: row.media_url || null,
      is_read: Boolean(row.is_read),
      read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
      timestamp: new Date(row.timestamp).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
    }));
  }

  async markConversationAsRead(identifier: string): Promise<StoredMessage[]> {
    const result = await this.pool.query<any>(
      `UPDATE messages
       SET is_read = TRUE, read_at = NOW()
       WHERE (contact_wa_id = $1 OR from_number = $1) AND is_read = FALSE
       RETURNING id, from_number, to_number, phone_number_id, contact_wa_id,
                 contact_name, message_type, body, timestamp, status,
                 is_read, read_at, raw_payload, created_at`,
      [identifier]
    );

    return result.rows.map((row) => ({
      ...row,
      is_read: Boolean(row.is_read),
      read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
      timestamp: new Date(row.timestamp).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
    }));
  }

  async markConversationAsUnread(identifier: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messages
       SET is_read = FALSE, read_at = NULL
       WHERE id = (
         SELECT id FROM messages
         WHERE contact_wa_id = $1 OR from_number = $1
         ORDER BY timestamp DESC, created_at DESC
         LIMIT 1
       )`,
      [identifier]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markMessageAsRead(messageId: string): Promise<StoredMessage | null> {
    const result = await this.pool.query<any>(
      `UPDATE messages
       SET is_read = TRUE, read_at = NOW()
       WHERE id = $1
       RETURNING id, from_number, to_number, phone_number_id, contact_wa_id,
                 contact_name, message_type, body, timestamp, status,
                 is_read, read_at, raw_payload, created_at`,
      [messageId]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      ...row,
      is_read: Boolean(row.is_read),
      read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
      timestamp: new Date(row.timestamp).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  async saveOutboundMessage(input: SaveOutboundMessageInput): Promise<StoredMessage> {
    const id = input.id || `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fromNumber = input.fromNumber || "me";
    const toNumber = input.toNumber;
    const contactWaId = input.contactWaId;
    const contactName = input.contactName || input.toNumber;
    const messageType = input.messageType || "text";
    const body = input.body;
    const mediaUrl = input.mediaUrl || null;
    const status = input.status || "sent";
    const timestamp = new Date();
    const rawPayload = input.rawPayload || { outbound: true };

    // Pastikan kontak ada di tabel contacts
    await this.pool.query(
      `INSERT INTO contacts (wa_id, name, phone_number, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wa_id) DO UPDATE SET
         name = COALESCE(contacts.name, EXCLUDED.name),
         phone_number = COALESCE(contacts.phone_number, EXCLUDED.phone_number),
         updated_at = NOW()`,
      [contactWaId, contactName, toNumber]
    );

    const result = await this.pool.query<any>(
      `INSERT INTO messages (
         id, from_number, to_number, phone_number_id,
         contact_wa_id, contact_name, message_type,
         body, timestamp, status, is_read, read_at,
         direction, media_url, raw_payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW(),
         'outbound', $11, $12
       ) RETURNING id, from_number, to_number, phone_number_id, contact_wa_id,
                 contact_name, message_type, body, timestamp, status,
                 is_read, read_at, direction, media_url, raw_payload, created_at`,
      [
        id,
        fromNumber,
        toNumber,
        input.phoneNumberId || null,
        contactWaId,
        contactName,
        messageType,
        body,
        timestamp,
        status,
        mediaUrl,
        JSON.stringify(rawPayload),
      ]
    );

    const row = result.rows[0];
    return {
      ...row,
      direction: row.direction || "outbound",
      media_url: row.media_url || null,
      is_read: Boolean(row.is_read),
      read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
      timestamp: new Date(row.timestamp).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  async saveWebhookLog(input: SaveWebhookLogInput): Promise<void> {
    const p = input.payload as any;
    const objectType =
      typeof p === "object" && p ? p.object || "whatsapp_business_account" : "unknown";
    const entryCount = Array.isArray(p?.entry) ? p.entry.length : 1;

    await this.pool.query(
      `INSERT INTO webhook_logs (status_code, ip_address, object_type, entry_count, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [input.statusCode, input.ipAddress, objectType, entryCount, JSON.stringify(input.payload)]
    );
  }

  async getWebhookLogs(limit = 50): Promise<WebhookLogItem[]> {
    const result = await this.pool.query<WebhookLogItem>(
      `SELECT id, status_code, ip_address, object_type, entry_count, payload, created_at
       FROM webhook_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      ...row,
      created_at: new Date(row.created_at).toISOString(),
    }));
  }

  async getWebhookLogById(id: string | number): Promise<WebhookLogItem | null> {
    const result = await this.pool.query<WebhookLogItem>(
      `SELECT id, status_code, ip_address, object_type, entry_count, payload, created_at
       FROM webhook_logs
       WHERE id = $1`,
      [id]
    );

    if (!result.rows.length || !result.rows[0]) return null;
    const row = result.rows[0];
    return {
      ...row,
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class MemoryMessageRepository implements MessageRepository {
  private accounts = new Map<string, Account>();
  private contacts = new Map<
    string,
    { wa_id: string; name: string; phone_number: string; updated_at: Date }
  >();
  private messages = new Map<string, StoredMessage>();
  private statuses: Array<{
    id: number;
    message_id: string;
    status: string;
    recipient_id?: string;
    timestamp?: Date;
    raw_payload: unknown;
  }> = [];
  private webhookLogs: WebhookLogItem[] = [];

  async init(): Promise<void> {
    if (this.accounts.size === 0) {
      const defaultUser = process.env.INITIAL_ADMIN_USERNAME || "admin";
      const defaultPass = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
      await this.createAccount(defaultUser, defaultPass);
    }
  }

  async createAccount(username: string, password: string): Promise<Account> {
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();
    const account: Account = {
      id: this.accounts.size + 1,
      username,
      password_hash: passwordHash,
      created_at: now,
      updated_at: now,
    };
    this.accounts.set(username, account);
    return account;
  }

  async findAccountByUsername(username: string): Promise<Account | null> {
    return this.accounts.get(username) ?? null;
  }

  async verifyAccountPassword(username: string, password: string): Promise<boolean> {
    const account = await this.findAccountByUsername(username);
    if (!account) return false;
    return verifyPassword(password, account.password_hash);
  }

  async updatePassword(username: string, newPassword: string): Promise<boolean> {
    const account = this.accounts.get(username);
    if (!account) return false;
    account.password_hash = hashPassword(newPassword);
    account.updated_at = new Date().toISOString();
    return true;
  }

  async saveIncomingMessage(msg: WhatsAppMessage, value: ChangeValue): Promise<void> {
    const contact = value.contacts?.find((c) => c.wa_id === msg.from) ?? value.contacts?.[0];
    const contactWaId = contact?.wa_id ?? msg.from;
    const contactName = contact?.profile?.name ?? msg.from;
    const toNumber = value.metadata?.display_phone_number ?? null;
    const phoneNumberId = value.metadata?.phone_number_id ?? null;
    const body = extractMessageBody(msg);
    const timestamp = parseTimestamp(msg.timestamp);

    this.contacts.set(contactWaId, {
      wa_id: contactWaId,
      name: contactName,
      phone_number: msg.from,
      updated_at: new Date(),
    });

    const now = new Date().toISOString();
    this.messages.set(msg.id, {
      id: msg.id,
      from_number: msg.from,
      to_number: toNumber,
      phone_number_id: phoneNumberId,
      contact_wa_id: contactWaId,
      contact_name: contactName,
      message_type: msg.type ?? "text",
      body,
      timestamp: timestamp.toISOString(),
      status: "received",
      is_read: false,
      read_at: null,
      direction: "inbound",
      media_url: null,
      raw_payload: { msg, value },
      created_at: now,
    });
  }

  async saveStatus(status: WhatsAppStatus, value: ChangeValue): Promise<void> {
    const timestamp = parseTimestamp(status.timestamp);
    this.statuses.push({
      id: this.statuses.length + 1,
      message_id: status.id,
      status: status.status,
      recipient_id: status.recipient_id,
      timestamp,
      raw_payload: { status, value },
    });

    const msg = this.messages.get(status.id);
    if (msg) {
      msg.status = status.status;
    }
  }

  async getConversations(): Promise<ConversationSummary[]> {
    const grouped = new Map<
      string,
      {
        contact_identifier: string;
        contact_name: string;
        from_number: string;
        last_message: string;
        last_timestamp: string;
        message_count: number;
        unread_count: number;
      }
    >();

    for (const msg of this.messages.values()) {
      const identifier = msg.contact_wa_id || (msg.direction === "outbound" ? msg.to_number : msg.from_number) || msg.from_number;
      const contact = this.contacts.get(identifier);
      const contactName = contact?.name || msg.contact_name || identifier;
      const phoneNumber = contact?.phone_number || (msg.direction === "outbound" ? msg.to_number : msg.from_number) || identifier;
      const isUnread = !msg.is_read;

      const existing = grouped.get(identifier);
      if (!existing) {
        grouped.set(identifier, {
          contact_identifier: identifier,
          contact_name: contactName,
          from_number: phoneNumber,
          last_message: msg.body,
          last_timestamp: msg.timestamp,
          message_count: 1,
          unread_count: isUnread ? 1 : 0,
        });
      } else {
        existing.message_count += 1;
        if (isUnread) {
          existing.unread_count += 1;
        }
        if (new Date(msg.timestamp) > new Date(existing.last_timestamp)) {
          existing.last_message = msg.body;
          existing.last_timestamp = msg.timestamp;
        }
      }
    }

    return Array.from(grouped.values()).sort(
      (a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime()
    );
  }

  async getMessagesByContact(identifier: string): Promise<StoredMessage[]> {
    const list: StoredMessage[] = [];
    for (const msg of this.messages.values()) {
      if (
        msg.contact_wa_id === identifier ||
        msg.from_number === identifier ||
        msg.to_number === identifier
      ) {
        list.push({ ...msg });
      }
    }
    return list.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async markConversationAsRead(identifier: string): Promise<StoredMessage[]> {
    const marked: StoredMessage[] = [];
    const now = new Date().toISOString();
    for (const msg of this.messages.values()) {
      if (
        (msg.contact_wa_id === identifier ||
          msg.from_number === identifier ||
          msg.to_number === identifier) &&
        !msg.is_read
      ) {
        msg.is_read = true;
        msg.read_at = now;
        marked.push({ ...msg });
      }
    }
    return marked;
  }

  async markConversationAsUnread(identifier: string): Promise<boolean> {
    const matching = Array.from(this.messages.values()).filter(
      (m) =>
        m.contact_wa_id === identifier ||
        m.from_number === identifier ||
        m.to_number === identifier
    );
    if (matching.length === 0) return false;
    matching.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latest = matching[0];
    if (!latest) return false;
    latest.is_read = false;
    latest.read_at = null;
    return true;
  }

  async markMessageAsRead(messageId: string): Promise<StoredMessage | null> {
    const msg = this.messages.get(messageId);
    if (!msg) return null;
    msg.is_read = true;
    msg.read_at = new Date().toISOString();
    return { ...msg };
  }

  async saveOutboundMessage(input: SaveOutboundMessageInput): Promise<StoredMessage> {
    const id = input.id || `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    const contactWaId = input.contactWaId;
    const toNumber = input.toNumber;
    const contactName = input.contactName || toNumber;

    if (!this.contacts.has(contactWaId)) {
      this.contacts.set(contactWaId, {
        wa_id: contactWaId,
        name: contactName,
        phone_number: toNumber,
        updated_at: new Date(),
      });
    }

    const msg: StoredMessage = {
      id,
      from_number: input.fromNumber || "me",
      to_number: toNumber,
      phone_number_id: input.phoneNumberId || null,
      contact_wa_id: contactWaId,
      contact_name: contactName,
      message_type: input.messageType || "text",
      body: input.body,
      timestamp: now,
      status: input.status || "sent",
      is_read: true,
      read_at: now,
      direction: "outbound",
      media_url: input.mediaUrl || null,
      raw_payload: input.rawPayload || { outbound: true },
      created_at: now,
    };
    this.messages.set(id, msg);
    return { ...msg };
  }

  async saveWebhookLog(input: SaveWebhookLogInput): Promise<void> {
    const p = input.payload as any;
    const objectType =
      typeof p === "object" && p ? p.object || "whatsapp_business_account" : "unknown";
    const entryCount = Array.isArray(p?.entry) ? p.entry.length : 1;
    const id = this.webhookLogs.length + 1;
    this.webhookLogs.unshift({
      id,
      status_code: input.statusCode,
      ip_address: input.ipAddress,
      object_type: objectType,
      entry_count: entryCount,
      payload: input.payload,
      created_at: new Date().toISOString(),
    });
  }

  async getWebhookLogs(limit = 50): Promise<WebhookLogItem[]> {
    return this.webhookLogs.slice(0, limit);
  }

  async getWebhookLogById(id: string | number): Promise<WebhookLogItem | null> {
    const item = this.webhookLogs.find((l) => String(l.id) === String(id));
    return item ?? null;
  }

  async close(): Promise<void> {
    this.accounts.clear();
    this.messages.clear();
    this.contacts.clear();
    this.statuses = [];
    this.webhookLogs = [];
  }
}
