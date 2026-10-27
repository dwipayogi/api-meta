export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  verifyToken: string;
  appSecret: string;
  databaseUrl?: string;
  sessionSecret: string;
  metaAccessToken?: string;
  metaApiVersion?: string;
  metaPhoneNumberId?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Environment variable wajib belum diisi: ${name}`);
  return value;
}

// Load & validasi env. Fail fast kalau ada yang kurang.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: Number(env.PORT) || 3000,
    logLevel: env.LOG_LEVEL ?? "info",
    verifyToken: required(env, "VERIFY_TOKEN"),
    appSecret: required(env, "APP_SECRET"),
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET ?? "wa-webhook-session-secret-change-in-production",
    metaAccessToken: env.META_ACCESS_TOKEN || undefined,
    metaApiVersion: env.META_API_VERSION || "v21.0",
    metaPhoneNumberId: env.META_PHONE_NUMBER_ID || undefined,
  };
}
