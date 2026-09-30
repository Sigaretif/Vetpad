import { vi } from "vitest";

// Every test starts in the zero-config state (CLAUDE.md): Supabase unconfigured, whatever a
// local .env or the shell holds, so no test reaches a real database by accident. A test that
// needs a configured client overrides this with its own vi.mock of the same module.
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: undefined,
  SUPABASE_KEY: undefined,
  getSecret: () => undefined,
}));
