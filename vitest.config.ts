/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import astroConfig from "./astro.config.mjs";

// The Cloudflare adapter boots workerd inside Vitest's Vite server and fails there;
// tests run in Node, so they get the project's Astro config minus the adapter.
const { adapter: _adapter, ...withoutAdapter } = astroConfig;

export default getViteConfig(
  { test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"] } },
  { ...withoutAdapter, configFile: false },
);
