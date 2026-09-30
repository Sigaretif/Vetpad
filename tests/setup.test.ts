import type { AstroCookies } from "astro";
import { SUPABASE_KEY, SUPABASE_URL } from "astro:env/server";
import { describe, expect, it } from "vitest";
import { createClient } from "@/lib/supabase";

// Guards tests/setup.ts: if its default mock is removed or broken, a local .env or CI's smoke
// .env would hand every test a real Supabase client.
describe("test environment", () => {
  it("sees Supabase as unconfigured", () => {
    expect(SUPABASE_URL).toBeUndefined();
    expect(SUPABASE_KEY).toBeUndefined();
  });

  it("gets no Supabase client", () => {
    const cookies = { set: () => undefined } as unknown as AstroCookies;
    expect(createClient(new Headers(), cookies)).toBeNull();
  });
});
