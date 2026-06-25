import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_TARGET = process.env.VF_BACKEND ?? 'http://127.0.0.1:17654';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': { target: BACKEND_TARGET, changeOrigin: true },
      '/api': { target: BACKEND_TARGET, changeOrigin: true, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
});
