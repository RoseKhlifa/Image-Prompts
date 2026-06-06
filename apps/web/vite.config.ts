/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = env.VITE_API_URL ?? "http://127.0.0.1:3000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      // Node 22+ ships experimental Web Storage that overrides jsdom's
      // localStorage on globalThis with a broken implementation (missing
      // Storage.prototype methods like clear()). Disable it inside the
      // forked test workers so jsdom's localStorage wins.
      pool: "forks",
      poolOptions: {
        forks: {
          execArgv: ["--no-experimental-webstorage"],
        },
      },
    },
  };
});
