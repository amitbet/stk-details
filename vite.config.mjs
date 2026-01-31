import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const preferredPort = Number(process.env.VITE_PORT || 5173);

// Backend is expected to run separately on http://localhost:3002 (via VSCode launch config).
export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  plugins: [react()],
  server: {
    port: preferredPort,
    // If the preferred port is busy, Vite will pick the next available port.
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    // Avoid browsers trying to fetch missing *.map files for prebundled deps.
    esbuildOptions: {
      sourcemap: false
    }
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  }
});

