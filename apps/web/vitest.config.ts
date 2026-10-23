import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // База в памяти (PGlite) поднимается заметно дольше обычного теста
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
