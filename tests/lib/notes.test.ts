import { afterEach, describe, expect, it, vi } from "vitest";
import { type OfferNotes, loadNotes } from "@/lib/notes";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase,
// @/lib/notes and @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what `loadNotes`
// returns: its contract and „Błąd odczytu ≠ brak notatki” in
// context/archive/2026-09-26-member-notes/plan.md, CLAUDE.md (## Structure, the `offer_notes`
// bullet: a failed read is its own state, never "no notes") and prd.md (Non-Functional
// Requirements, a deleted member's notes; Guardrails, notes are never overwritten).
//
// The two states that must never be confused are "the read failed" and "the offer has no notes":
// an empty editor shown for a failed read would overwrite the member's note on save. Every
// failure below stands beside the read that succeeds and finds nothing.

afterEach(restoreFetch);

const OFFER = "0b9f0c2e-7d1a-4c55-9a53-0000000000f1";

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const BARTEK = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";

const ANNA_EMAIL = "anna@example.test";
const BARTEK_EMAIL = "bartek@example.test";

/** "The offer has no notes": a successful read, with nothing in it. */
const NO_NOTES: OfferNotes = { state: "ok", own: null, others: [] };
const FAILED: OfferNotes = { state: "error" };

// Rows as PostgREST answers them, in the order of the answer: most recently edited first.
const ANNA_ROW = {
  id: "c0000000-0000-4000-8000-0000000000a1",
  author_id: ANNA,
  pros: "Cicha ulica",
  cons: "Czwarte piętro bez windy",
  observations: "Dopytać o księgę wieczystą",
  updated_at: "2026-09-28T18:30:00+00:00",
};
const VIEWER_ROW = {
  id: "c0000000-0000-4000-8000-00000000beef",
  author_id: VIEWER,
  pros: "Blisko metra",
  cons: "",
  observations: "Obejrzeć w sobotę",
  updated_at: "2026-09-27T09:15:00+00:00",
};
const BARTEK_ROW = {
  id: "c0000000-0000-4000-8000-0000000000b2",
  author_id: BARTEK,
  pros: "",
  cons: "Okna na północ",
  observations: "",
  updated_at: "2026-09-26T07:00:00+00:00",
};
/** A note whose author's account was deleted: `on delete set null` left the row in place. */
const ORPHAN_ROW = {
  id: "c0000000-0000-4000-8000-0000000000d4",
  author_id: null,
  pros: "Duży balkon",
  cons: "Wysoki czynsz",
  observations: "",
  updated_at: "2026-09-25T12:00:00+00:00",
};

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

/**
 * Answers the read of `public.offer_notes` with `notes` and the read of `public.members` with
 * `members`. Without `members`, a request to that table is unplanned and fails the test.
 */
function stubNotes(notes: () => Response, members?: () => Response) {
  return stubFetch((request) => {
    if (isTableRequest(request, "offer_notes", "GET")) return notes();
    if (isTableRequest(request, "members", "GET")) return members?.();
    return undefined;
  });
}

/** A read the database failed, the way PostgREST reports one. */
function failedRead(): Response {
  return jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500);
}

function bothMembers(): Response {
  return jsonResponse(
    [
      { id: BARTEK, email: BARTEK_EMAIL },
      { id: ANNA, email: ANNA_EMAIL },
    ],
    200,
  );
}

function requestsTo(requests: RecordedRequest[], table: string): RecordedRequest[] {
  return requests.filter((request) => isTableRequest(request, table, "GET"));
}

describe("loadNotes: a failed read is its own state, never an offer without notes (#1)", () => {
  it("control: answers an offer without notes for a read that succeeds and finds none", async () => {
    const stub = stubNotes(() => jsonResponse([], 200));

    expect(await loadNotes(client(), OFFER, VIEWER)).toEqual({ state: "ok", own: null, others: [] });

    // Nobody to name, so `members` is not asked.
    expect(stub.requests).toHaveLength(1);
    expect(isTableRequest(stub.requests[0], "offer_notes", "GET")).toBe(true);
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const notes = await loadNotes(null, OFFER, VIEWER);

    expect(notes).toEqual({ state: "error" });
    expect(notes).not.toEqual(NO_NOTES);
    expect(stub.requests).toHaveLength(0);
  });

  it("answers error when the database fails the read (500), and does not ask for members", async () => {
    const stub = stubNotes(failedRead);

    const notes = await loadNotes(client(), OFFER, VIEWER);

    expect(notes).toEqual({ state: "error" });
    expect(notes).not.toEqual(NO_NOTES);
    expect(requestsTo(stub.requests, "offer_notes")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  // A 200 the code cannot walk as rows: the exception stays inside the function.
  it.each<[string, unknown]>([
    ["an object", {}],
    ["null", null],
    ["a list holding something that is not a row", [null]],
  ])("answers error for a 200 whose body is %s, and does not throw", async (_case, body) => {
    const stub = stubNotes(() => jsonResponse(body, 200));

    const notes = await loadNotes(client(), OFFER, VIEWER);

    expect(notes).toEqual({ state: "error" });
    expect(notes).not.toEqual(NO_NOTES);
    // The outcome came from the database's answer — the read did go out.
    expect(requestsTo(stub.requests, "offer_notes")).toHaveLength(1);
  });
});

describe("loadNotes: a successful read splits the notes into the viewer's own and the rest (#1)", () => {
  it("puts the viewer's note in own, signed self, and the rest in others in the order answered", async () => {
    const stub = stubNotes(() => jsonResponse([ANNA_ROW, VIEWER_ROW, BARTEK_ROW], 200), bothMembers);

    expect(await loadNotes(client(), OFFER, VIEWER)).toEqual({
      state: "ok",
      own: {
        id: "c0000000-0000-4000-8000-00000000beef",
        author: { kind: "self" },
        pros: "Blisko metra",
        cons: "",
        observations: "Obejrzeć w sobotę",
        updatedAt: "2026-09-27T09:15:00+00:00",
      },
      others: [
        {
          id: "c0000000-0000-4000-8000-0000000000a1",
          author: { kind: "member", email: "anna@example.test" },
          pros: "Cicha ulica",
          cons: "Czwarte piętro bez windy",
          observations: "Dopytać o księgę wieczystą",
          updatedAt: "2026-09-28T18:30:00+00:00",
        },
        {
          id: "c0000000-0000-4000-8000-0000000000b2",
          author: { kind: "member", email: "bartek@example.test" },
          pros: "",
          cons: "Okna na północ",
          observations: "",
          updatedAt: "2026-09-26T07:00:00+00:00",
        },
      ],
    });

    // One read of the notes, then one read naming every other author.
    expect(requestsTo(stub.requests, "offer_notes")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
    expect(stub.requests).toHaveLength(2);
  });

  it("leaves own empty when the viewer has written no note on this offer", async () => {
    stubNotes(() => jsonResponse([BARTEK_ROW, ANNA_ROW], 200), bothMembers);

    const notes = await loadNotes(client(), OFFER, VIEWER);

    expect(notes).toMatchObject({ state: "ok", own: null });
    expect(notes.state === "ok" ? notes.others.map((note) => note.id) : null).toEqual([
      "c0000000-0000-4000-8000-0000000000b2",
      "c0000000-0000-4000-8000-0000000000a1",
    ]);
  });

  it("asks for the notes of this offer, most recently edited first", async () => {
    const stub = stubNotes(() => jsonResponse([], 200));

    await loadNotes(client(), OFFER, VIEWER);

    const [request] = stub.requests;
    expect(isTableRequest(request, "offer_notes", "GET")).toBe(true);
    const params = new URL(request.url).searchParams;
    expect(params.get("offer_id")).toBe("eq.0b9f0c2e-7d1a-4c55-9a53-0000000000f1");
    expect(params.get("order")).toBe("updated_at.desc");
    // Every column a note's view is built from (member-notes plan, the `loadNotes` contract).
    expect(params.get("select")).toBe("id,author_id,pros,cons,observations,updated_at");
  });
});

describe("loadNotes: a note whose author's account is gone stays on the offer (#1)", () => {
  const ORPHAN_VIEW = {
    id: "c0000000-0000-4000-8000-0000000000d4",
    author: { kind: "deleted" },
    pros: "Duży balkon",
    cons: "Wysoki czynsz",
    observations: "",
    updatedAt: "2026-09-25T12:00:00+00:00",
  };

  it("puts it in others, signed deleted, beside the viewer's own note", async () => {
    const stub = stubNotes(() => jsonResponse([VIEWER_ROW, ORPHAN_ROW], 200));

    const notes = await loadNotes(client(), OFFER, VIEWER);

    expect(notes).toMatchObject({ state: "ok", own: { id: "c0000000-0000-4000-8000-00000000beef" } });
    expect(notes).toMatchObject({ others: [ORPHAN_VIEW] });
    // A null author and the viewer need no read of `members`.
    expect(stub.requests).toHaveLength(1);
  });

  // `undefined === undefined` and `null == undefined` are the two ways a note with no author
  // could be taken for the note of a viewer with no id.
  it("never puts it in own, also for a viewer with no id", async () => {
    stubNotes(() => jsonResponse([ORPHAN_ROW], 200));

    expect(await loadNotes(client(), OFFER, undefined)).toEqual({ state: "ok", own: null, others: [ORPHAN_VIEW] });
  });
});

describe("loadNotes: a failed read of the authors' names does not hide the notes (#1)", () => {
  it("keeps the state ok and shows each note, its author unknown — never deleted", async () => {
    const stub = stubNotes(() => jsonResponse([ANNA_ROW, VIEWER_ROW, ORPHAN_ROW], 200), failedRead);

    const notes = await loadNotes(client(), OFFER, VIEWER);

    expect(notes).toEqual({
      state: "ok",
      own: {
        id: "c0000000-0000-4000-8000-00000000beef",
        author: { kind: "self" },
        pros: "Blisko metra",
        cons: "",
        observations: "Obejrzeć w sobotę",
        updatedAt: "2026-09-27T09:15:00+00:00",
      },
      others: [
        {
          id: "c0000000-0000-4000-8000-0000000000a1",
          author: { kind: "unknown" },
          pros: "Cicha ulica",
          cons: "Czwarte piętro bez windy",
          observations: "Dopytać o księgę wieczystą",
          updatedAt: "2026-09-28T18:30:00+00:00",
        },
        {
          id: "c0000000-0000-4000-8000-0000000000d4",
          author: { kind: "deleted" },
          pros: "Duży balkon",
          cons: "Wysoki czynsz",
          observations: "",
          updatedAt: "2026-09-25T12:00:00+00:00",
        },
      ],
    });
    expect(notes).not.toEqual(FAILED);
    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
  });
});
