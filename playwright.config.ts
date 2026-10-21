import { defineConfig, devices } from "@playwright/test";
import { localSupabase } from "./e2e/support/env";

// Browser integration tests: the production build of the app against the local Supabase stack
// (real auth, Edge Functions, and database policies). Setup and commands: README.md, "Browser Integration Tests".

const supabase = localSupabase();
const PORT = 4180;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  // Every test creates its own players and matches, but the scenarios hold requests at
  // barriers and count server rows, so they run one at a time for readable failures.
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The service worker would cache the shell between tests; requests must reach the routes.
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Full Chromium in new headless mode renders the PixiJS (WebGL) board on the GPU. The
        // default headless shell renders it in software, which starved the page for minutes when
        // two boards were open at once.
        channel: "chromium",
        viewport: { width: 1280, height: 860 }
      }
    },
    {
      // Playwright's build of WebKit, Safari's engine, on a Retina-density desktop. It is not
      // Safari itself (see README.md), and runs the rendering-resource suite only.
      name: "webkit",
      testMatch: "resources.e2e.ts",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 860 } }
    }
  ],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: supabase.apiUrl,
      VITE_SUPABASE_ANON_KEY: supabase.anonKey
    }
  }
});
