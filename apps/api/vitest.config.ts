import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
