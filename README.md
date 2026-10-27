# WhatsApp Webhook & Viewer (TypeScript + PostgreSQL)

Endpoint webhook untuk WhatsApp Business Platform (Meta) dilengkapi penyimpanan ke database **PostgreSQL** dan antarmuka web interaktif bergaya **WhatsApp Web** dengan sistem login untuk melihat percakapan serta detail raw JSON payload.

Stack: Node.js 22+, Express 5, TypeScript, PostgreSQL (`pg`), Pino.

## Fitur Utama

1. **Webhook Meta WhatsApp Platform**:
   - Verifikasi token (`GET /whatsapp`)
   - Verifikasi signature HMAC-SHA256 (`POST /whatsapp`)
   - Deduplikasi event berbasis in-memory
2. **Penyimpanan PostgreSQL**:
   - Tabel `accounts`: menyimpan kredensial akun login (`username`, `password_hash` dengan hashing `scrypt`). **Tidak di-hardcode di `.env`**.
   - Tabel `contacts`: profil kontak WhatsApp (`wa_id`, nama, nomor telepon)
   - Tabel `messages`: riwayat pesan lengkap (`id`, nomor pengirim, nomor penerima, isi pesan, timestamp, `is_read`, `read_at`, `status`, raw payload JSONB)
   - Tabel `message_statuses`: update status pesan keluar (`sent`, `delivered`, `read`, `failed`)
   - Tabel `webhook_logs`: riwayat setiap raw payload JSON yang berhasil diterima dari Meta.
   - Otomatis inisialisasi tabel (*auto migration*) saat pertama kali aplikasi dijalankan.
   - *Fallback* otomatis ke `MemoryMessageRepository` jika `DATABASE_URL` belum diset (sangat membantu saat dev lokal / testing).
3. **WhatsApp Web UI & Payload Viewer**:
   - Tampilan chat modern persis WhatsApp Web (daftar kontak di kiri, balon pesan di kanan).
   - **Indikator Unread & Status Baca (WhatsApp Style)**:
     - Badge bulat hijau unread count pada percakapan dengan pesan baru yang belum dibaca.
     - Teks nama kontak, cuplikan pesan, dan timestamp dibuat tebal (*bold*) berwarna hijau untuk pesan belum dibaca.
     - Balon pesan dilengkapi status centang WhatsApp: Centang 1 abu-abu (terkirim), Centang 2 abu-abu (tersampaikan), dan Centang 2 biru (sudah dibaca).
     - Garis pembatas *"PESAN BELUM DIBACA"* saat membuka obrolan dengan pesan baru.
     - Auto-read saat obrolan dibuka/dipilih.
     - Tombol cepat **"Tandai Belum Dibaca"** dan **"Tandai Sudah Dibaca"** di header obrolan dan item percakapan.
   - **Integrasi Dua Arah Meta Cloud API (Mark as Read)**:
     - Saat pesan dibuka/ditandai dibaca di dashboard, sistem dapat mengirim *read receipt* ke Meta Graph API sehingga tanda centang di aplikasi WhatsApp pelanggan otomatis berubah menjadi **centang dua biru**.
   - Fitur **Inspect Payload**: tombol pada setiap balon pesan untuk membuka modal dan melihat seluruh raw JSON payload dari Meta secara terformat, lengkap dengan tombol salin (copy JSON).
   - Halaman **Log Webhook** (`/logs`): melihat seluruh payload webhook yang masuk secara real-time.
   - Fitur **Ganti Password**: modal untuk memperbarui password akun langsung di database.
   - *Live auto-sync* (pembaruan pesan otomatis setiap 3 detik).
4. **Sistem Login & Proteksi Auth**:
   - Halaman login (`/login`) memverifikasi username & password langsung terhadap database `accounts`.
   - Menggunakan hashing `scrypt` dengan random salt dan timing-safe comparison.
   - Proteksi cookie session aman (HMAC-signed HttpOnly cookie).

---

## Alur Sistem

```
Meta ──POST /whatsapp──> verifikasi X-Hub-Signature-256
                     ──> dedup per pesan/status
                     ──> simpan ke PostgreSQL (contacts, messages, raw_payload, webhook_logs)
                     ──> 200 (sukses) atau 500 (Meta retry)

Browser ──GET /login ──> autentikasi user terhadap tabel `accounts` di PostgreSQL
        ──GET /      ──> antarmuka WhatsApp Web UI (auto-sync pesan & viewer JSON payload)
        ──GET /logs  ──> antarmuka Log Payload Webhook
```

---

## Menjalankan

### 1. Lokal (Node.js)

```bash
npm install
cp .env.example .env     # sesuaikan VERIFY_TOKEN, APP_SECRET, DATABASE_URL
npm run dev              # development dengan auto-reload (tsx)
```

Buka browser di:
- **Dashboard / Chat UI:** [http://localhost:3000](http://localhost:3000)
- **Log Payload Webhook:** [http://localhost:3000/logs](http://localhost:3000/logs)
- **Login:** Username: `admin`, Password: `admin123` *(kredensial awal otomatis di-seed ke tabel `accounts` saat pertama kali database dijalankan)*

### 2. Menggunakan Docker Compose (App + PostgreSQL)

```bash
docker compose up -d
```

### 3. Pengujian & Tipe

```bash
npm test                 # menjalankan unit test
npm run typecheck        # cek validasi tipe TypeScript
npm run build && npm start   # build & jalankan versi production
```

---

## Skema Database PostgreSQL

Skema otomatis dibuat saat aplikasi start, atau dapat dijalankan manual dari [`src/db/schema.sql`](file:///Users/dwipayogi/Downloads/whatsapp-webhook/src/db/schema.sql):

- **`accounts`**: `id` (PK), `username` (UNIQUE), `password_hash` (scrypt hash), `created_at`, `updated_at`
- **`contacts`**: `wa_id` (PK), `name`, `phone_number`, `created_at`, `updated_at`
- **`messages`**: `id` (PK, WhatsApp message ID / wamid), `from_number`, `to_number`, `phone_number_id`, `contact_wa_id`, `contact_name`, `message_type`, `body`, `timestamp`, `status`, `raw_payload` (JSONB), `created_at`
- **`message_statuses`**: `id` (PK), `message_id`, `status`, `recipient_id`, `timestamp`, `raw_payload` (JSONB), `created_at`
- **`webhook_logs`**: `id` (PK), `status_code`, `ip_address`, `object_type`, `entry_count`, `payload` (JSONB), `created_at`
