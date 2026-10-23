/**
 * Подключение к базе. Миграции из папки drizzle/ применяются при первом обращении.
 *
 * DATABASE_URL:
 *   postgres://…      — PostgreSQL (сервер, docker-compose);
 *   pglite:<папка>    — встроенный PostgreSQL в файлах (разработка без Docker);
 *   pglite:memory     — в памяти (тесты);
 *   не задан          — разработка: pglite в apps/web/.data/pglite. На сервере (production) — ошибка.
 */
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
}

async function connectPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const db = drizzle(new Pool({ connectionString: url, max: 10 }), { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db as unknown as Db;
}

async function connectPglite(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db as unknown as Db;
}

function connect(url: string | undefined): Promise<Db> {
  if (url?.startsWith("postgres://") || url?.startsWith("postgresql://")) return connectPostgres(url);
  if (url === "pglite:memory") return connectPglite(undefined);
  if (url?.startsWith("pglite:")) return connectPglite(url.slice("pglite:".length));
  if (process.env.NODE_ENV === "production") {
    return Promise.reject(new Error("DATABASE_URL не задан — на сервере нужен PostgreSQL"));
  }
  return connectPglite(path.join(process.cwd(), ".data", "pglite"));
}

// Одно подключение на процесс; в разработке переживает перезагрузку модулей
const holder = globalThis as unknown as { __diagDb?: Promise<Db> | undefined };

export function getDb(): Promise<Db> {
  holder.__diagDb ??= connect(process.env.DATABASE_URL).catch((err: unknown) => {
    holder.__diagDb = undefined;
    throw err;
  });
  return holder.__diagDb;
}

/** Отдельная пустая база в памяти — для тестов. */
export function createTestDb(): Promise<Db> {
  return connectPglite(undefined);
}

export { schema };
