import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: {
    target: "chrome120",
    rollupOptions: {
      input: {
        main: "index.html",
        pill: "pill.html",
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], passWithNoTests: true },
});
