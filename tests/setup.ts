import { vi } from "vitest";

// Every test starts in the zero-config state (CLAUDE.md): Supabase, the model provider, Apify and
// both Google Maps keys unconfigured, whatever a local .env or the shell holds, so no test reaches a
// real database, a paid model call, a paid Apify run or a paid Google request by accident. A test that needs a configured client overrides
// this with its own vi.mock of the same module — and names every export the code it imports reads.
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: undefined,
  SUPABASE_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  APIFY_TOKEN: undefined,
  GOOGLE_MAPS_SERVER_KEY: undefined,
  GOOGLE_MAPS_BROWSER_KEY: undefined,
  getSecret: () => undefined,
}));
