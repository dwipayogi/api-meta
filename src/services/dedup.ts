// Dedup per item (pesan / status). Meta bisa mengirim event yang sama berulang kali
// (retry sampai 7 hari), dan batching tidak dijamin konsisten.
//
// Implementasi ini in-memory: cukup untuk SATU instance. State hilang saat restart dan
// tidak dibagi antar instance. Interface-nya async supaya bisa diganti Redis/DB nanti
// tanpa mengubah pemanggil.
export interface Dedup {
  seen(key: string): Promise<boolean>;
  mark(key: string): Promise<void>;
  stop(): void;
}

const DAY_MS = 24 * 3600 * 1000;

export function createMemoryDedup(ttlMs = 8 * DAY_MS, maxEntries = 100_000): Dedup {
  const expiries = new Map<string, number>();

  const sweep = () => {
    const now = Date.now();
    for (const [key, exp] of expiries) if (exp <= now) expiries.delete(key);
  };
  const timer = setInterval(sweep, 10 * 60 * 1000);
  timer.unref(); // jangan menahan proses saat shutdown

  return {
    async seen(key) {
      const exp = expiries.get(key);
      if (exp === undefined) return false;
      if (exp <= Date.now()) {
        expiries.delete(key);
        return false;
      }
      return true;
    },
    async mark(key) {
      expiries.set(key, Date.now() + ttlMs);
      if (expiries.size > maxEntries) {
        // buang entri paling lama (urutan insert Map)
        const oldest = expiries.keys().next().value;
        if (oldest !== undefined) expiries.delete(oldest);
      }
    },
    stop() {
      clearInterval(timer);
    },
  };
}
