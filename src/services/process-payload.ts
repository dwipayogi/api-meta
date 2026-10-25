import type { Handlers } from "./handlers";
import type { Dedup } from "./dedup";
import type { WebhookPayload } from "../types";

// Memproses satu POST dari Meta (bisa berisi sampai 1000 update).
// Item ditandai "sudah diproses" SETELAH handler sukses, jadi kalau satu item gagal,
// Meta retry dan hanya item yang belum selesai yang dijalankan ulang.
export function createPayloadProcessor(deps: { dedup: Dedup; handlers: Handlers }) {
  const { dedup, handlers } = deps;

  async function runOnce(key: string, fn: () => Promise<void>): Promise<void> {
    if (await dedup.seen(key)) return;
    await fn();
    await dedup.mark(key);
  }

  return async function processPayload(payload: WebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        for (const msg of value.messages ?? []) {
          await runOnce(`msg:${msg.id}`, () => handlers.handleMessage(msg, value));
        }
        for (const status of value.statuses ?? []) {
          await runOnce(`status:${status.id}:${status.status}`, () =>
            handlers.handleStatus(status, value)
          );
        }
      }
    }
  };
}

export type PayloadProcessor = ReturnType<typeof createPayloadProcessor>;
