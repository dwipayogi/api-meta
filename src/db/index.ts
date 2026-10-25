import { Pool } from "pg";
import type { Config } from "../config";
import type { Logger } from "../logger";
import {
  type MessageRepository,
  PgMessageRepository,
  MemoryMessageRepository,
} from "./repository";

export async function createRepository(
  config: Config,
  logger: Logger
): Promise<MessageRepository> {
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL;

  if (databaseUrl) {
    try {
      const pool = new Pool({
        connectionString: databaseUrl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Test koneksi
      const client = await pool.connect();
      client.release();

      const repo = new PgMessageRepository(pool);
      await repo.init();
      logger.info("Berhasil terhubung ke database PostgreSQL dan inisialisasi tabel");
      return repo;
    } catch (err) {
      logger.error(
        { err },
        "Gagal terhubung ke PostgreSQL. Menggunakan MemoryMessageRepository sebagai fallback."
      );
    }
  } else {
    logger.info(
      "DATABASE_URL tidak diset. Menggunakan MemoryMessageRepository (in-memory) untuk penyimpanan sementara."
    );
  }

  const memoryRepo = new MemoryMessageRepository();
  await memoryRepo.init();
  return memoryRepo;
}

export * from "./repository";
