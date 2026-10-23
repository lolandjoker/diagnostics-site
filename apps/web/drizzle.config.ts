import { defineConfig } from "drizzle-kit";

// Только для генерации миграций (pnpm db:generate); подключение к базе не нужно
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
