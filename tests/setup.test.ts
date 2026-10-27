import type { AstroCookies } from "astro";
import {
  ANTHROPIC_API_KEY,
  APIFY_TOKEN,
  GOOGLE_MAPS_BROWSER_KEY,
  GOOGLE_MAPS_SERVER_KEY,
  SUPABASE_KEY,
  SUPABASE_URL,
} from "astro:env/server";
import { describe, expect, it } from "vitest";
import { createAuditProvider } from "@/lib/audit/provider";
import { createRoutesClient } from "@/lib/commute/google";
import { isCommuteAvailable, isCommuteMapAvailable } from "@/lib/config-status";
import { createApifyLeg } from "@/lib/otodom/apify";
import { createClient } from "@/lib/supabase";

// Guards tests/setup.ts: if its default mock is removed or broken, a local .env or CI's smoke
// .env would hand every test a real Supabase client — and a local .env with a provider key, an
// Apify token or a Google Maps key would hand it a client that makes paid model calls, paid Apify
// runs or paid Google requests.
describe("test environment", () => {
  it("sees Supabase as unconfigured", () => {
    expect(SUPABASE_URL).toBeUndefined();
    expect(SUPABASE_KEY).toBeUndefined();
  });

  it("sees the model provider as unconfigured", () => {
    expect(ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("gets no model provider", () => {
    expect(createAuditProvider()).toBeNull();
  });

  it("sees Apify as unconfigured", () => {
    expect(APIFY_TOKEN).toBeUndefined();
  });

  it("gets no Apify leg", () => {
    expect(createApifyLeg()).toBeNull();
  });

  it("sees both Google Maps keys as unconfigured", () => {
    expect(GOOGLE_MAPS_SERVER_KEY).toBeUndefined();
    expect(GOOGLE_MAPS_BROWSER_KEY).toBeUndefined();
  });

  it("offers neither a commute calculation nor its map", () => {
    expect(isCommuteAvailable()).toBe(false);
    expect(isCommuteMapAvailable()).toBe(false);
  });

  it("gets no Routes client", () => {
    expect(createRoutesClient()).toBeNull();
  });

  it("gets no Supabase client", () => {
    const cookies = { set: () => undefined } as unknown as AstroCookies;
    expect(createClient(new Headers(), cookies)).toBeNull();
  });
});
