import { defineConfig } from "@playwright/test";

// One shared kernel behind the app → tests run serially in a single worker.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1600, height: 950 },
    launchOptions: {
      // Headless Chromium (and WSL) need SwiftShader for WebGL2.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "python ../scripts/dev.py",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
