import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pino from "pino";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { createMemoryDedup } from "../src/services/dedup";
import type { Handlers } from "../src/services/handlers";
import { createPayloadProcessor } from "../src/services/process-payload";

const config: Config = {
  nodeEnv: "test",
  port: 0,
  logLevel: "silent",
  verifyToken: "token-rahasia",
  appSecret: "app-secret-test",
  sessionSecret: "test-session-secret",
};

const logger = pino({ level: "silent" });
const dedup = createMemoryDedup();

let calls: string[] = [];
let failNextMessage = false;

const handlers: Handlers = {
  async handleMessage(msg) {
    if (failNextMessage) {
      failNextMessage = false;
      throw new Error("handler error");
    }
    calls.push(`msg:${msg.id}`);
  },
  async handleStatus(status) {
    calls.push(`status:${status.id}:${status.status}`);
  },
};

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp({
    config,
    logger,
    processPayload: createPayloadProcessor({ dedup, handlers }),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  dedup.stop();
  server.close();
});

const sign = (raw: string, secret = config.appSecret) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

const post = (raw: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });

const payload = (messageId: string) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messages: [{ id: messageId, from: "628123", timestamp: "1", type: "text" }],
              statuses: [{ id: `s-${messageId}`, status: "delivered" }],
            },
          },
        ],
      },
    ],
  });

test("GET: token benar -> 200 + challenge", async () => {
  const url = `${baseUrl}/whatsapp?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=${config.verifyToken}`;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "1158201444");
});

test("GET: token salah -> 403", async () => {
  const url = `${baseUrl}/whatsapp?hub.mode=subscribe&hub.challenge=1&hub.verify_token=salah`;
  assert.equal((await fetch(url)).status, 403);
});

test("GET: mode bukan subscribe -> 403", async () => {
  const url = `${baseUrl}/whatsapp?hub.mode=foo&hub.challenge=1&hub.verify_token=${config.verifyToken}`;
  assert.equal((await fetch(url)).status, 403);
});

test("POST: tanpa signature -> 401, handler tidak dipanggil", async () => {
  calls = [];
  assert.equal((await post(payload("m-nosig"))).status, 401);
  assert.deepEqual(calls, []);
});

test("POST: signature salah -> 401, handler tidak dipanggil", async () => {
  calls = [];
  const raw = payload("m-badsig");
  const res = await post(raw, { "x-hub-signature-256": sign(raw, "secret-lain") });
  assert.equal(res.status, 401);
  assert.deepEqual(calls, []);
});

test("POST: signature valid -> 200, pesan dan status diproses", async () => {
  calls = [];
  const raw = payload("m-ok");
  const res = await post(raw, { "x-hub-signature-256": sign(raw) });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["msg:m-ok", "status:s-m-ok:delivered"]);
});

test("POST: retry dari Meta tidak memproses item dua kali", async () => {
  calls = [];
  const raw = payload("m-dup");
  const headers = { "x-hub-signature-256": sign(raw) };
  assert.equal((await post(raw, headers)).status, 200);
  assert.equal((await post(raw, headers)).status, 200);
  assert.deepEqual(calls, ["msg:m-dup", "status:s-m-dup:delivered"]);
});

test("POST: handler gagal -> 500, lalu retry berhasil diproses", async () => {
  calls = [];
  const raw = payload("m-fail");
  const headers = { "x-hub-signature-256": sign(raw) };

  failNextMessage = true;
  assert.equal((await post(raw, headers)).status, 500);
  assert.deepEqual(calls, []);

  assert.equal((await post(raw, headers)).status, 200);
  assert.deepEqual(calls, ["msg:m-fail", "status:s-m-fail:delivered"]);
});

test("POST: object bukan whatsapp_business_account -> 200 tanpa proses", async () => {
  calls = [];
  const raw = JSON.stringify({ object: "page", entry: [] });
  const res = await post(raw, { "x-hub-signature-256": sign(raw) });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, []);
});

test("/health -> 200", async () => {
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});
