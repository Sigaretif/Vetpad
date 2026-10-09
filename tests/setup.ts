import { vi } from "vitest";

// Every test starts in the zero-config state (CLAUDE.md): Supabase and the model provider
// unconfigured, whatever a local .env or the shell holds, so no test reaches a real database or
// a paid model call by accident. A test that needs a configured client overrides this with its
// own vi.mock of the same module — and names every export the code it imports reads.
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: undefined,
  SUPABASE_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  getSecret: () => undefined,
}));
