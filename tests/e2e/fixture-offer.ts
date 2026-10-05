import { expect, type APIRequestContext } from "@playwright/test";
import { testUser } from "./helpers";

/**
 * A fixture offer for a spec that needs a card to work on. The app saves an offer only by fetching
 * otodom.pl, which E2E never reaches, so the row goes in through the local Data API as the E2E
 * member — under the same row-level security the app's own writes pass — in the shape
 * `scripts/smoke.mjs` uses. Every call is asserted: a setup or a cleanup that fails turns the run red.
 */
export interface MemberApi {
  userId: string;
  headers: Record<string, string>;
}

function supabase(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_KEY in .env (context/foundation/test-stack.md, ## E2E)");
  }
  return { url, key };
}

/**
 * The E2E member's own Data API session. A password sign-in adds a session and revokes none, so
 * the saved one the specs load stays valid.
 */
export async function memberApi(request: APIRequestContext): Promise<MemberApi> {
  const { url, key } = supabase();
  const { username, password } = testUser();
  const response = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: key },
    data: { email: username, password },
  });
  await expect(response, "the E2E member signs in to the Data API").toBeOK();
  const session = (await response.json()) as { access_token: string; user: { id: string } };
  return {
    userId: session.user.id,
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, Prefer: "return=representation" },
  };
}

/** Saves the offer `offerId` as the member. The id is the caller's, so the cleanup knows it even if this fails. */
export async function createFixtureOffer(
  request: APIRequestContext,
  member: MemberApi,
  offerId: string,
  title: string,
): Promise<void> {
  const response = await request.post(`${supabase().url}/rest/v1/offers`, {
    headers: member.headers,
    data: {
      id: offerId,
      created_by: member.userId,
      otodom_id: Math.floor(Math.random() * 2 ** 48),
      source_url: `https://example.com/e2e/${offerId}`,
      title,
      description: "Oferta utworzona przez test E2E i usuwana po nim.",
      raw: {},
    },
  });
  await expect(response, "the fixture offer is saved").toBeOK();
}

/**
 * Deletes the offer and, through the cascade, every note on it. Judged by rows, never by status
 * alone: a delete that row-level security denies answers 200 with `[]`.
 */
export async function deleteFixtureOffer(
  request: APIRequestContext,
  member: MemberApi,
  offerId: string,
): Promise<void> {
  const { url } = supabase();
  const deleted = await request.delete(`${url}/rest/v1/offers?id=eq.${offerId}`, { headers: member.headers });
  await expect(deleted, "the fixture offer is deleted").toBeOK();
  expect(await deleted.json(), "exactly the fixture offer was deleted").toHaveLength(1);

  const notes = await request.get(`${url}/rest/v1/offer_notes?offer_id=eq.${offerId}&select=id`, {
    headers: member.headers,
  });
  await expect(notes, "the fixture offer's notes are read").toBeOK();
  expect(await notes.json(), "no note of the fixture offer is left").toEqual([]);
}
