import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev proxy lets you point /health and /api at a non-default backend via VF_BACKEND.
// Set the in-app Base URL to empty to route through this proxy; otherwise the app talks
// directly to DEFAULT_BASE_URL (the backend sends Access-Control-Allow-Origin: *).
const backend = process.env.VF_BACKEND ?? "http://127.0.0.1:17654";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": { target: backend, changeOrigin: true },
      "/api": { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
