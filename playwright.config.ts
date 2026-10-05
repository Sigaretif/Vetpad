import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

// E2E_USERNAME and E2E_PASSWORD come from the gitignored .env. In CI the file may be absent and
// the variables come from the job.
if (existsSync(".env")) process.loadEnvFile(".env");

// E2E writes real rows through the app, so it runs against a local Supabase only — the guard
// scripts/smoke.mjs applies. The preview reads .dev.vars, not .env, so both are checked.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const devVars = existsSync(".dev.vars") ? parseEnv(readFileSync(".dev.vars", "utf8")) : {};
for (const [source, url] of [
  [".env", process.env.SUPABASE_URL],
  [".dev.vars", devVars.SUPABASE_URL],
] as const) {
  if (url && !LOCAL_HOSTS.includes(new URL(url).hostname)) {
    throw new Error(`SUPABASE_URL in ${source} is not a local Supabase; E2E never runs against a hosted project.`);
  }
}

// 4321 is Astro's default preview port: astro.config.mjs and the preview script set none.
// E2E_PORT overrides it when that port is taken on this machine.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // `open: "never"`: the default serves the report after a red run and waits for Ctrl+C.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // The production build on the Cloudflare runtime, on the port above — what smoke runs against.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7 moves `astro preview` into a background daemon when it detects an agent: the npm
    // process exits, Playwright reports "exited early", and the daemon keeps the port.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
