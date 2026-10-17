import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ports come from scripts/dev.py, so the e2e suite can run beside `pixi run dev`.
const BACKEND = `127.0.0.1:${process.env.GEOSANDBOX_BACKEND_PORT ?? 8765}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.GEOSANDBOX_FRONTEND_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://${BACKEND}`, ws: true },
      "/api": { target: `http://${BACKEND}` },
    },
  },
  // Pre-bundle lazily imported deps so Vite never reloads the page mid-session.
  optimizeDeps: { include: ["three", "three/examples/jsm/controls/OrbitControls.js", "proj4"] },
  build: { chunkSizeWarningLimit: 6000 },
  worker: { format: "es" },
});
