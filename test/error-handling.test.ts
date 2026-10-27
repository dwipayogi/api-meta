import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pino from "pino";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { MemoryMessageRepository } from "../src/db/repository";
import { createMemoryDedup } from "../src/services/dedup";
import { createHandlers } from "../src/services/handlers";
import { createPayloadProcessor } from "../src/services/process-payload";

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
let sessionCookie: string;

before(async () => {
  await repository.init();
  const app = createApp({
    config,
    logger,
    processPayload,
    repository,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Login untuk dapat cookie sesi
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const cookieHeader = loginRes.headers.get("set-cookie");
  assert.ok(cookieHeader);
  sessionCookie = cookieHeader.split(";")[0]!;
});

after(() => {
  dedup.stop();
  server.close();
});

test("Error handling: Request dengan JSON rusak menghasilkan status 400 dan pesan error jelas", async () => {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ malformed json",
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.error.includes("JSON"));
});

test("Error handling: Endpoint /api yang tidak ada menghasilkan 404 dalam format JSON", async () => {
  const res = await fetch(`${baseUrl}/api/non-existent-endpoint`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 404);
  const data = (await res.json()) as any;
  assert.equal(data.error, "Endpoint API tidak ditemukan");
});

test("Error handling: Validasi ganti password dengan password kosong atau kependekan ditolak dengan 400", async () => {
  // Password kosong
  const res1 = await fetch(`${baseUrl}/api/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: "", newPassword: "123" }),
  });
  assert.equal(res1.status, 400);
  const data1 = (await res1.json()) as any;
  assert.ok(data1.error);

  // Password kependekan (< 6)
  const res2 = await fetch(`${baseUrl}/api/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: "admin123", newPassword: "123" }),
  });
  assert.equal(res2.status, 400);
  const data2 = (await res2.json()) as any;
  assert.ok(data2.error.includes("6 karakter"));

  // Password baru sama dengan password lama
  const res3 = await fetch(`${baseUrl}/api/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: "admin123", newPassword: "admin123" }),
  });
  assert.equal(res3.status, 400);
  const data3 = (await res3.json()) as any;
  assert.ok(data3.error.includes("tidak boleh sama"));
});

test("Error handling: Pengiriman pesan tanpa nomor kontak atau isi pesan ditolak dengan 400", async () => {
  // Tanpa contact
  const form1 = new FormData();
  form1.append("message", "Test");
  const res1 = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: form1,
  });
  assert.equal(res1.status, 400);
  const data1 = (await res1.json()) as any;
  assert.ok(data1.error.includes("contact"));

  // Tanpa message dan tanpa file
  const form2 = new FormData();
  form2.append("contact", "123456");
  const res2 = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: form2,
  });
  assert.equal(res2.status, 400);
  const data2 = (await res2.json()) as any;
  assert.ok(data2.error.includes("Pesan teks atau file lampiran"));
});

test("Error handling: Request pesan /api/messages tanpa contact parameter menghasilkan 400", async () => {
  const res = await fetch(`${baseUrl}/api/messages`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.error.includes("contact"));
});

test("Error handling: Request detail log /api/webhook-logs/:id yang tidak ditemukan menghasilkan 404", async () => {
  const res = await fetch(`${baseUrl}/api/webhook-logs/99999999`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 404);
  const data = (await res.json()) as any;
  assert.equal(data.error, "Log webhook tidak ditemukan");
});

test("Error handling: Request mark message read untuk ID yang tidak ada menghasilkan 404", async () => {
  const res = await fetch(`${baseUrl}/api/messages/nonexistent-id/read`, {
    method: "PATCH",
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 404);
  const data = (await res.json()) as any;
  assert.equal(data.error, "Pesan tidak ditemukan");
});
