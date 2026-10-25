# Menjalankan Proyek dengan PM2

Panduan menjalankan **WhatsApp Webhook & Viewer** (`api-meta`) secara production memakai [PM2](https://pm2.keymetrics.io/) — proses manager untuk Node.js yang menyediakan *auto-restart*, logging, monitoring, dan auto-start saat server reboot.

Stack: Node.js 22+ (dites di Node 26), Express 5, TypeScript, PostgreSQL.

---

## 1. Prasyarat

| Kebutuhan | Cek | Keterangan |
|---|---|---|
| Node.js >= 22 | `node -v` | Untuk fitur `--env-file` |
| PM2 | `pm2 -v` | Belum terpasang? `npm install -g pm2` |
| `.env` | `ls .env` | Salin dari `.env.example`, isi `VERIFY_TOKEN`, `APP_SECRET`, `DATABASE_URL` |
| PostgreSQL | — | Bisa juga tanpa DB (*fallback* in-memory), tapi tidak disarankan untuk production |

```bash
npm install
cp .env.example .env   # jika belum ada, lalu isi nilainya
```

---

## 2. Build

PM2 menjalankan hasil build, bukan file `src/`:

```bash
npm run build          # menghasilkan dist/server.js
npm run typecheck      # opsional: validasi tipe
```

> Jalankan ulang `npm run build` setiap kali kode berubah, lalu `pm2 restart api-meta`.

---

## 3. File `ecosystem.config.js`

Buat file berikut di root proyek:

```js
module.exports = {
  apps: [
    {
      name: "api-meta",
      script: "dist/server.js",
      node_args: "--env-file=.env", // WAJIB: baca .env (lihat bagian 6)
      cwd: __dirname,

      // Fork 1 instance. JANGAN pakai cluster (lihat bagian 7).
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      max_memory_restart: "300M",
      min_uptime: "10s",
      max_restarts: 10,

      // Graceful shutdown (server.ts sudah menangani SIGTERM/SIGINT)
      kill_timeout: 12_000,
      listen_timeout: 10_000,

      // Logging
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      time: true,

      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
```

**Penjelasan penting:**

- `node_args: "--env-file=.env"` — `npm run dev` memuat `.env` lewat `tsx --env-file`, tetapi entry production (`node dist/server.js`) **tidak memuat env apa pun**. Karena `loadConfig()` mewajibkan `VERIFY_TOKEN` dan `APP_SECRET`, tanpa opsi ini proses langsung keluar dengan `Environment variable wajib belum diisi: ...`.
- `instances: 1` + `exec_mode: "fork"` — deduplikasi event webhook disimpan *in-memory* per proses. Mode cluster akan menduplikasi logika tersebut dan berisiko memproses payload Meta dua kali.
- `kill_timeout` > 10 detik — `server.ts` memberi batas 10 detik untuk proses shutdown (menutup server + koneksi database) sebelum `process.exit(1)`.

---

## 4. Perintah Dasar

```bash
# Jalankan
pm2 start ecosystem.config.js

# Cek status & kesehatan
pm2 status
pm2 describe api-meta
pm2 info api-meta

# Log realtime
pm2 logs api-meta
pm2 logs api-meta --lines 200

# Hentikan / jalankan / restart
pm2 stop api-meta
pm2 start api-meta
pm2 restart api-meta

# Graceful reload (SIGINT → proses lama tutup rapat sebelum proses baru jalan)
pm2 reload api-meta

# Hapus dari daftar PM2
pm2 delete api-meta
```

Setelah perubahan kode:

```bash
npm run build && pm2 reload api-meta
```

---

## 5. Log & Monitoring

```bash
pm2 logs api-meta                 # tail semua log (out + error)
pm2 monit                         # monitoring realtime: CPU, memori, log
pm2 prettylist                    # daftar app dalam format YAML/JSON
```

Log juga ditulis ke file:

- `logs/out.log` — log standar (termasuk log Pino)
- `logs/error.log` — log error

Direktori `logs/*.log` sudah tercakup oleh `.gitignore` (`*.log`).

Rotasi log (disarankan untuk server jangka panjang):

```bash
npm install -g pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 6. Environment Variables

PM2 **tidak** membaca `.env` secara otomatis. Dua cara yang valid:

**Cara A (disarankan, dipakai di `ecosystem.config.js` di atas):**

```js
node_args: "--env-file=.env"
```

Satu sumber kebenaran: file `.env` yang sama dipakai dev (`npm run dev`) dan production.

**Cara B (alternatif, env via PM2):**

```bash
pm2 start ecosystem.config.js --env production
```

dengan blok `env_production` diisi manual — artinya nilai env harus diduplikasi dari `.env`, rentan tidak sinkron. Gunakan hanya bila Anda butuh parameter khusus per environment.

> **Keamanan:** `.env` berisi `APP_SECRET` dan `SESSION_SECRET`. Jangan commit, jangan taruh di `env:` secara literal, dan jangan tampilkan lewat `pm2 env <id>` pada log bersama.

---

## 7. Hal yang Harus Dihindari

| Salah | Benar | Alasan |
|---|---|---|
| `pm2 start npm -- start` | `pm2 start ecosystem.config.js` | `node dist/server.js` tidak memuat `.env` → crash saat `loadConfig()` |
| `instances: "max"` / cluster | `instances: 1`, fork | Dedup in-memory per proses → payload bisa diproses ganda |
| `watch: true` | default (mati) | Restart tiap kali file berubah, termasuk saat `tsc` menulis `dist/` |
| Menjalankan `tsx watch` di production | `dist/server.js` | `tsx` ada di `devDependencies` dan auto-reload tidak diperlukan |

---

## 8. Auto-Start saat Reboot

```bash
pm2 startup
# → akan mencetak perintah sudo, contoh:
#   sudo env PATH=$PATH:/home/mayagatra/.nvm/versions/node/v26.7.0/bin \
#        /home/mayagatra/.nvm/versions/node/v26.7.0/lib/node_modules/pm2/bin/pm2 \
#        startup systemd -u mayagatra --hp /home/mayagatra

pm2 save          # simpan daftar proses yang sedang jalan
```

Setelah ini PM2 akan otomatis membangkitkan `api-meta` saat server menyala.

---

## 9. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `Environment variable wajib belum diisi: VERIFY_TOKEN` | `.env` tidak dibaca | Tambahkan `node_args: "--env-file=.env"`, lalu `pm2 restart api-meta --update-env` |
| App langsung `errored` / restart loop | Build belum jalan / error TypeScript | `npm run build`, lalu periksa `pm2 logs api-meta` |
| `EADDRINUSE: address already in use :::3000` | Masih ada proses lama (mis. `npm run dev`) | `lsof -i :3000` lalu hentikan, atau ubah `PORT` di `.env` |
| Tidak ada data / koneksi DB gagal | `DATABASE_URL` salah atau Postgres mati | Cek `.env`, `systemctl status postgresql`, dan log |
| Perubahan kode tidak terlihat | Lupa build / restart | `npm run build && pm2 reload api-meta` |
| Proses mati saat deploy | Shutdown timeout terlalu kecil | Pastikan `kill_timeout` >= 12 detik |
| Webhook Meta di-retry berkali-kali | Aplikasi balas 500 (error simpan DB) | Cek `pm2 logs api-meta` dan koneksi PostgreSQL |

---

## 10. Ringkasan Perintah (Cheat Sheet)

```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 status
pm2 logs api-meta

npm run build && pm2 reload api-meta   # deploy perubahan

pm2 save && pm2 startup                # sekali saja: auto-start reboot
pm2 monit                              # monitoring realtime
pm2 stop api-meta                      # hentikan
pm2 delete api-meta                    # hapus dari daftar
```

Aplikasi berjalan di `http://localhost:3000` (atau sesuai `PORT` di `.env`).

---

## Alternatif

- **Docker Compose:** `docker compose up -d` (App + PostgreSQL dalam satu perintah)
- **systemd:** cocok bila Anda tidak ingin PM2; buat unit service yang menjalankan `npm start` dengan `EnvironmentFile=.env` dan `Restart=always`
- **Development:** tetap gunakan `npm run dev` (auto-reload), tidak perlu PM2
