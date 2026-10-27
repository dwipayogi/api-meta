import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pino from "pino";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { MemoryMessageRepository } from "../src/db/repository";
import { createMemoryDedup } from "../src/services/dedup";
import { createHandlers } from "../src/services/handlers";
import { createPayloadProcessor } from "../src/services/process-payload";
import {
  sendMarkAsReadToMeta,
  sendMediaMessageToMeta,
  sendTextMessageToMeta,
} from "../src/services/meta-api";

const config: Config = {
  nodeEnv: "test",
  port: 0,
  logLevel: "silent",
  verifyToken: "test-token",
  appSecret: "test-secret",
  sessionSecret: "test-session-secret",
};

const logger = pino({ level: "silent" });
const dedup = createMemoryDedup();
const repository = new MemoryMessageRepository();
const handlers = createHandlers(logger, repository);
const processPayload = createPayloadProcessor({ dedup, handlers });

let server: Server;
let baseUrl: string;

before(async () => {
  await repository.init(); // Inisialisasi akun admin default di DB
  const app = createApp({
    config,
    logger,
    processPayload,
    repository,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  dedup.stop();
  server.close();
});

const sign = (raw: string, secret = config.appSecret) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

// Payload dari prompt user
const userExamplePayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "215589313241560883",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15551797781",
              phone_number_id: "7794189252778687",
            },
            contacts: [
              {
                profile: {
                  name: "Jessica Laverdetman",
                },
                wa_id: "13557825698",
              },
            ],
            messages: [
              {
                from: "17863559966",
                id: "wamid.HBgLMTc4NjM1NTk5NjYVAGHAYWYET688aASGNTI1QzZFQjhEMDk2QQA=",
                timestamp: "1758254144",
                text: {
                  body: "Hi!",
                },
                type: "text",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

test("Webhook memproses dan menyimpan pesan dari payload contoh pengguna ke repository", async () => {
  const raw = JSON.stringify(userExamplePayload);
  const res = await fetch(`${baseUrl}/whatsapp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw),
    },
    body: raw,
  });

  assert.equal(res.status, 200);

  // Verifikasi data di repository
  const conversations = await repository.getConversations();
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].contact_name, "Jessica Laverdetman");
  assert.equal(conversations[0].last_message, "Hi!");
  assert.equal(conversations[0].from_number, "17863559966");

  const messages = await repository.getMessagesByContact("13557825698");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, "Hi!");
  assert.equal(messages[0].id, "wamid.HBgLMTc4NjM1NTk5NjYVAGHAYWYET688aASGNTI1QzZFQjhEMDk2QQA=");
  assert.equal(messages[0].phone_number_id, "7794189252778687");
  assert.ok(messages[0].raw_payload);

  // Verifikasi log webhook otomatis tersimpan
  const webhookLogs = await repository.getWebhookLogs();
  assert.ok(webhookLogs.length >= 1);
  assert.equal(webhookLogs[0].status_code, 200);
  assert.equal(webhookLogs[0].object_type, "whatsapp_business_account");
  assert.deepEqual(webhookLogs[0].payload, userExamplePayload);
});

test("Proteksi Auth: Akses /api/conversations tanpa login menghasilkan 401", async () => {
  const res = await fetch(`${baseUrl}/api/conversations`);
  assert.equal(res.status, 401);
});

test("Proteksi Auth: Akses / tanpa login redirect ke /login", async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("Proteksi Auth: Akses /logs tanpa login redirect ke /login", async () => {
  const res = await fetch(`${baseUrl}/logs`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("Login dengan password salah ditolak", async () => {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrongpassword" }),
  });
  assert.equal(res.status, 401);
});

test("Login menggunakan akun dari DB (default admin / admin123)", async () => {
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert.equal(loginRes.status, 200);

  const cookieHeader = loginRes.headers.get("set-cookie");
  assert.ok(cookieHeader);
  const sessionCookie = cookieHeader.split(";")[0];

  // Request percakapan dengan cookie
  const convRes = await fetch(`${baseUrl}/api/conversations`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(convRes.status, 200);

  // Request halaman UI log payload (/logs)
  const logsPageRes = await fetch(`${baseUrl}/logs`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(logsPageRes.status, 200);
});

test("Akun baru di DB dapat dibuat dan langsung bisa login", async () => {
  // Buat akun baru langsung di DB
  await repository.createAccount("operator", "passOperator123");

  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "operator", password: "passOperator123" }),
  });
  assert.equal(loginRes.status, 200);

  const cookieHeader = loginRes.headers.get("set-cookie");
  assert.ok(cookieHeader);
  const sessionCookie = cookieHeader.split(";")[0];

  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.username, "operator");
});

test("Ganti password akun via /api/change-password memperbarui kredensial di database", async () => {
  // Login dulu dengan admin
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  // Ganti password
  const changeRes = await fetch(`${baseUrl}/api/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: "admin123", newPassword: "newAdminPassword456" }),
  });
  assert.equal(changeRes.status, 200);

  // Coba login dengan password lama -> harus gagal
  const oldLoginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert.equal(oldLoginRes.status, 401);

  // Coba login dengan password baru -> harus berhasil
  const newLoginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "newAdminPassword456" }),
  });
  assert.equal(newLoginRes.status, 200);
});

test("Unread count dan status baca: pesan baru masuk berstatus belum dibaca, bisa ditandai read dan unread", async () => {
  // Login dengan admin
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "newAdminPassword456" }),
  });
  const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  // Pastikan percakapan dari tes pertama memiliki unread_count = 1
  const convsRes = await fetch(`${baseUrl}/api/conversations`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(convsRes.status, 200);
  const convs = await convsRes.json();
  const contact = convs.find((c: any) => c.contact_identifier === "13557825698");
  assert.ok(contact);
  assert.equal(contact.unread_count, 1);

  // Panggil endpoint /api/conversations/:contact/read
  const readRes = await fetch(`${baseUrl}/api/conversations/13557825698/read`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  assert.equal(readRes.status, 200);
  const readData = await readRes.json();
  assert.equal(readData.ok, true);
  assert.equal(readData.markedCount, 1);

  // Cek lagi /api/conversations -> unread_count harus menjadi 0
  const convsAfterRead = await (
    await fetch(`${baseUrl}/api/conversations`, { headers: { cookie: sessionCookie } })
  ).json();
  const contactAfterRead = convsAfterRead.find((c: any) => c.contact_identifier === "13557825698");
  assert.equal(contactAfterRead.unread_count, 0);

  // Cek detail pesan -> is_read harus true
  const msgsRes = await fetch(`${baseUrl}/api/messages?contact=13557825698`, {
    headers: { cookie: sessionCookie },
  });
  const msgs = await msgsRes.json();
  assert.equal(msgs[0].is_read, true);
  assert.ok(msgs[0].read_at);

  // Panggil endpoint /api/conversations/:contact/unread
  const unreadRes = await fetch(`${baseUrl}/api/conversations/13557825698/unread`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  assert.equal(unreadRes.status, 200);
  const unreadData = await unreadRes.json();
  assert.equal(unreadData.ok, true);

  // Cek lagi /api/conversations -> unread_count harus kembali menjadi 1
  const convsAfterUnread = await (
    await fetch(`${baseUrl}/api/conversations`, { headers: { cookie: sessionCookie } })
  ).json();
  const contactAfterUnread = convsAfterUnread.find((c: any) => c.contact_identifier === "13557825698");
  assert.equal(contactAfterUnread.unread_count, 1);
});

test("sendMarkAsReadToMeta: fungsi helper Meta Graph API menangani pengiriman dan graceful fallback", async () => {
  // Test fallback ketika token belum dikonfigurasi
  const resultWithoutToken = await sendMarkAsReadToMeta(
    { metaAccessToken: undefined, metaPhoneNumberId: "12345" },
    logger,
    { messageId: "wamid.test123" }
  );
  assert.equal(resultWithoutToken.success, false);
  assert.equal(resultWithoutToken.skipped, true);
  assert.equal(resultWithoutToken.reason, "META_ACCESS_TOKEN_NOT_CONFIGURED");

  // Test fallback ketika phone number id tidak ada
  const resultWithoutPhone = await sendMarkAsReadToMeta(
    { metaAccessToken: "test_token", metaPhoneNumberId: undefined },
    logger,
    { messageId: "wamid.test123" }
  );
  assert.equal(resultWithoutPhone.success, false);
  assert.equal(resultWithoutPhone.skipped, true);
  assert.equal(resultWithoutPhone.reason, "PHONE_NUMBER_ID_MISSING");
});

test("sendTextMessageToMeta & sendMediaMessageToMeta: graceful fallback saat token/phone id tidak diset", async () => {
  const textRes = await sendTextMessageToMeta(
    { metaAccessToken: undefined, metaPhoneNumberId: "123" },
    logger,
    { to: "123456", body: "Halo" }
  );
  assert.equal(textRes.success, false);
  assert.equal(textRes.skipped, true);

  const mediaRes = await sendMediaMessageToMeta(
    { metaAccessToken: undefined, metaPhoneNumberId: "123" },
    logger,
    { to: "123456", filePath: "dummy", mimeType: "image/png", filename: "test.png" }
  );
  assert.equal(mediaRes.success, false);
  assert.equal(mediaRes.skipped, true);
});

test("API /api/messages/send: Mengirim pesan balasan teks dan pesan file berhasil disimpan dan tampil di histori", async () => {
  // Login dengan admin
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "newAdminPassword456" }),
  });
  const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  // 1. Kirim pesan teks balasan
  const sendForm = new FormData();
  sendForm.append("contact", "13557825698");
  sendForm.append("message", "Halo ini balasan dari admin!");

  const sendTextRes = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: sendForm,
  });
  assert.equal(sendTextRes.status, 200);
  const textData = await sendTextRes.json();
  assert.equal(textData.ok, true);
  assert.equal(textData.message.body, "Halo ini balasan dari admin!");
  assert.equal(textData.message.direction, "outbound");

  // 2. Kirim pesan dengan lampiran file
  const fileContent = "Isi file dokumen penawaran harga...";
  const blob = new Blob([fileContent], { type: "text/plain" });

  const sendFileForm = new FormData();
  sendFileForm.append("contact", "13557825698");
  sendFileForm.append("message", "Silakan cek penawaran kami:");
  sendFileForm.append("file", blob, "penawaran.txt");

  const sendFileRes = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: sendFileForm,
  });
  assert.equal(sendFileRes.status, 200);
  const fileData = await sendFileRes.json();
  assert.equal(fileData.ok, true);
  assert.equal(fileData.message.direction, "outbound");
  assert.ok(fileData.message.media_url);
  assert.equal(fileData.message.message_type, "document");

  // 3. Verifikasi histori percakapan kontak
  const msgsRes = await fetch(`${baseUrl}/api/messages?contact=13557825698`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(msgsRes.status, 200);
  const messages = await msgsRes.json();
  assert.ok(messages.length >= 3); // 1 pesan masuk + 2 pesan keluar

  const outboundMsgs = messages.filter((m: any) => m.direction === "outbound");
  assert.equal(outboundMsgs.length, 2);
  assert.equal(outboundMsgs[0].body, "Halo ini balasan dari admin!");
  assert.equal(outboundMsgs[1].body, "Silakan cek penawaran kami:");
  assert.ok(outboundMsgs[1].media_url);
});
