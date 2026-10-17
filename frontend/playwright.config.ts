import { defineConfig } from "@playwright/test";

// The suite starts its own servers (and so its own kernel) on separate ports:
// it never touches a `pixi run dev` session. One kernel → tests run serially.
const FRONTEND_PORT = 5174;
const BACKEND_PORT = 8766;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    viewport: { width: 1600, height: 950 },
    launchOptions: {
      // Headless Chromium (and WSL) need SwiftShader for WebGL2.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "python ../scripts/dev.py",
    url: `http://127.0.0.1:${FRONTEND_PORT}`,
    env: { GEOSANDBOX_FRONTEND_PORT: String(FRONTEND_PORT), GEOSANDBOX_BACKEND_PORT: String(BACKEND_PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
