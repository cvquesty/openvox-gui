import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Read the application version from the root VERSION file, which is the
// single source of truth shared by the backend (__init__.py), the
// frontend (version.ts), and the package.json. Vite injects this as
// a build-time constant accessible via the global `__APP_VERSION__`.
const appVersion = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf-8').trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // During local development, Vite's dev server proxies all /api and
    // /health requests to the FastAPI backend running on port 4567. This
    // avoids CORS issues and mimics the production setup where nginx (or
    // uvicorn directly) serves both the SPA and the API on the same port.
    proxy: {
      '/api': {
        target: 'http://localhost:4567',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4567',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
