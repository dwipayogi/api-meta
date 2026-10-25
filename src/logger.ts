import pino, { type Logger } from "pino";

export type { Logger };

// Jangan pernah log payload webhook utuh: berisi nomor telepon & isi pesan pengguna.
export function createLogger(level = "info", nodeEnv = "development"): Logger {
  const pretty = nodeEnv !== "production" && level !== "silent";
  return pino({
    level,
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
