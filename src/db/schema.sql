-- PostgreSQL Schema untuk WhatsApp Webhook
-- Menyimpan akun, kontak, pesan, riwayat status pesan, dan log payload webhook

-- Tabel akun login admin
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- Tabel kontak pengirim WhatsApp
CREATE TABLE IF NOT EXISTS contacts (
  wa_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255),
  phone_number VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabel pesan
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
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_from_number ON messages(from_number);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_contact_wa_id ON messages(contact_wa_id);

-- Tabel riwayat status pesan (sent, delivered, read, failed)
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

-- Tabel log payload webhook yang berhasil diterima (HTTP 200)
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
