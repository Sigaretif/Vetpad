import { vi } from "vitest";

// The HTTP edge, and only the HTTP edge: tests replace `globalThis.fetch` and nothing inside
// src/ (test-plan.md, anti-patterns — no vi.mock of @/lib/supabase or @/lib/otodom). Both the
// otodom fetch and supabase-js look `fetch` up on the global at call time, so one stub sees
// every request either of them makes.
//
// Every request goes through a handler. A request the handler does not answer is recorded as
// unplanned and rejected; `restoreFetch` then fails the test, because supabase-js and the
// otodom fetch both turn a rejected fetch into an ordinary error result that could otherwise
// pass unnoticed. No test can reach the real network.

/** One request as the stub saw it. `body` is the raw string that would go on the wire. */
export interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

/** Answers a request, or returns `undefined` for a request the test did not plan. */
export type FetchHandler = (request: RecordedRequest) => Response | Promise<Response> | undefined;

export interface FetchStub {
  /** Every request, planned or not, in the order it was made. */
  requests: RecordedRequest[];
  /** Requests the handler did not answer. `restoreFetch` fails the test if this is not empty. */
  unplanned: RecordedRequest[];
}

let active: FetchStub | undefined;

function recordBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  throw new Error(`fetch stub: cannot record a ${typeof body} body — extend recordBody`);
}

/** Installs a fetch stub that records every request and answers it through `handler`. */
export function stubFetch(handler: FetchHandler): FetchStub {
  const stub: FetchStub = { requests: [], unplanned: [] };
  active = stub;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: RecordedRequest =
      input instanceof Request
        ? { method: input.method, url: input.url, body: input.body === null ? null : await input.text() }
        : { method: init?.method ?? "GET", url: String(input), body: recordBody(init?.body) };
    stub.requests.push(request);

    // A real fetch rejects with the signal's reason once it is aborted; so does the stub.
    const signal = input instanceof Request ? input.signal : init?.signal;
    if (signal?.aborted) throw signal.reason;

    const response = await handler(request);
    if (response === undefined) {
      stub.unplanned.push(request);
      throw new Error(`fetch stub: unplanned request ${request.method} ${request.url}`);
    }
    return response;
  });
  return stub;
}

/** Removes the stub. Fails the test when a request reached it that no handler planned for. */
export function restoreFetch(): void {
  const stub = active;
  active = undefined;
  vi.unstubAllGlobals();
  if (stub !== undefined && stub.unplanned.length > 0) {
    const list = stub.unplanned.map((request) => `${request.method} ${request.url}`).join(", ");
    throw new Error(`fetch stub: unplanned requests: ${list}`);
  }
}

/**
 * A `Response` as `fetch` hands it back. `new Response()` leaves `url` as "", which the otodom
 * fetch reads as "no redirect happened"; a test of a followed redirect passes the address the
 * redirect landed on, the way a real fetch reports it.
 */
export function responseAt(
  body: string | null,
  { status = 200, url }: { status?: number; url?: string } = {},
): Response {
  const response = new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (url !== undefined) Object.defineProperty(response, "url", { value: url });
  return response;
}

// otodom pages (otodom_fetching.md, section 7.1): the offer page embeds its data as JSON in
// <script id="__NEXT_DATA__" type="application/json">, shaped { props: { pageProps: { ad } } }.

function page(scripts: string): string {
  return (
    '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Otodom</title></head>' +
    `<body><div id="__next"><main><h1>Ogłoszenie</h1></main></div>${scripts}</body></html>`
  );
}

/** A page whose `__NEXT_DATA__` script holds `json` as written — which may be broken JSON. */
export function pageWithNextData(json: string): string {
  return page(`<script id="__NEXT_DATA__" type="application/json">${json}</script>`);
}

/** A page whose `__NEXT_DATA__` holds `{ props: { pageProps } }`. */
export function otodomPageProps(pageProps: Record<string, unknown>): string {
  return pageWithNextData(JSON.stringify({ props: { pageProps }, page: "/[lang]/ad/[id]", buildId: "test" }));
}

/** An offer page carrying `ad` the way the portal serves it. */
export function otodomPage(ad: unknown): string {
  return otodomPageProps({ ad });
}

/** A page without any `__NEXT_DATA__` script: the shape the fetch cannot read. */
export const PAGE_WITHOUT_NEXT_DATA = page('<script id="__APP_DATA__" type="application/json">{}</script>');

// Supabase, as the offers route talks to it (supabase-js / postgrest-js 2.116, read from
// node_modules/@supabase/postgrest-js/dist/index.mjs):
//
// - Duplicate check, `.from("offers").select("id").eq("source_url", url).maybeSingle()`:
//   `GET <SUPABASE_URL>/rest/v1/offers?select=id&source_url=eq.<url>` with the default
//   `Accept: application/json`. `maybeSingle()` only sets a client-side flag; PostgREST answers
//   an array, and the client turns `200 []` into `data: null` (no duplicate), `[row]` into `row`.
// - Insert, `.from("offers").insert(row).select("id").single()`:
//   `POST <SUPABASE_URL>/rest/v1/offers?select=id` with `Content-Type: application/json`,
//   `Prefer: return=representation` and `Accept: application/vnd.pgrst.object+json`; the body is
//   `JSON.stringify(row)`. PostgREST answers `201` with the single object, here `{ "id": … }`.
// - Every request also carries `apikey` (and `Authorization: Bearer` with the key when there is
//   no session). With no session cookie the auth client makes no request of its own.
// - postgrest-js retries a GET that rejects (up to 3 times, with back-off), so an unplanned
//   GET fails slowly — but it still fails, through `restoreFetch`.
//
// And as the criteria route talks to it, read from the same file:
//
// - Limits save or clear, `.from("team_criteria").update(values).eq("id", true).select("id")`:
//   `PATCH <SUPABASE_URL>/rest/v1/team_criteria?id=eq.true&select=id` with
//   `Content-Type: application/json` and `Prefer: return=representation`; the body is
//   `JSON.stringify(values)`. PostgREST answers `200` with an array of the rows it changed —
//   `[{ "id": true }]`, or `[]` when RLS filtered the update down to no row, which is not an
//   error. A refused write answers `403` with `{ "code": "42501", … }`.
//
// And as the member-naming module (src/lib/members.ts) talks to it, read from the same file:
//
// - One member, `.from("members").select("email").eq("id", id).maybeSingle()`:
//   `GET <SUPABASE_URL>/rest/v1/members?select=email&id=eq.<id>`. As with the duplicate check,
//   `maybeSingle()` is a client-side flag: `200 []` becomes `data: null` with no error (no
//   `members` row), `[row]` becomes `row`, and more than one row becomes an error, `PGRST116`.
// - Many members, `.from("members").select("id, email").in("id", ids)`:
//   `GET <SUPABASE_URL>/rest/v1/members?select=id,email&id=in.(<id>,<id>,…)` — the client strips
//   the whitespace from `select`, drops repeated values from the list, and the URL carries the
//   comma and the parentheses percent-encoded (`URLSearchParams` reads them back decoded).
//   PostgREST answers `200` with an array of rows; an id without a row is simply absent from it.
// - A failed read, for any of the reads above: `500` with `{ "code", "message", … }` gives a
//   result with `error` set, at once — no retry. `503`, `520` and a rejected `fetch` are retried
//   for a GET (up to 3 times, with back-off, about 7 s) and only then end as a result with
//   `error`; none of them throws, so no test here uses them. A `404` whose body is an array is
//   turned into `data: []` with no error — it does not stand in for a failed read.
// - The client never throws for a response. What makes the calling code throw is a `200` whose
//   body is not the shape the code walks — an object where it iterates rows.
//
// And as the notes module (src/lib/notes.ts) reads an offer's notes, read from the same file:
//
// - The notes of one offer, `.from("offer_notes").select("id, author_id, pros, cons,
//   observations, updated_at").eq("offer_id", offerId).order("updated_at", { ascending: false })`:
//   `GET <SUPABASE_URL>/rest/v1/offer_notes?select=id,author_id,pros,cons,observations,updated_at
//   &offer_id=eq.<id>&order=updated_at.desc` — `select` with its whitespace stripped, and
//   `order` as `<column>.desc` with no `nullsfirst`/`nullslast` suffix, since the call passes no
//   `nullsFirst`. PostgREST answers `200` with an array of rows, `[]` for an offer without notes.
// - After it, only when a row's author is somebody other than the viewer, the one "many members"
//   request above — none at all when every author is `null` or the viewer, or there are no rows.
// - A failed read and the answer that makes the code throw are the two general points above:
//   `500` with `{ "code", "message", … }`, and a `200` whose body is not an array.

/** Test values only — never a real project's. */
export const SUPABASE_TEST_URL = "https://supabase.test";
export const SUPABASE_TEST_KEY = "sb_publishable_test";

/** The id the stubbed database gives the inserted offer. */
export const INSERTED_OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-000000000001";

/** A JSON answer the way PostgREST sends one. */
export function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

/** True for a request to the Data API endpoint of `public.<table>` in the stubbed Supabase. */
export function isTableRequest(request: RecordedRequest, table: string, method: string): boolean {
  const url = new URL(request.url);
  return url.origin === SUPABASE_TEST_URL && url.pathname === `/rest/v1/${table}` && request.method === method;
}

/** True for a request to the `public.offers` endpoint of the stubbed Supabase. */
export function isOffersRequest(request: RecordedRequest, method: string): boolean {
  return isTableRequest(request, "offers", method);
}

/**
 * Answers the offers route's two planned Supabase requests: the duplicate check by `source_url`
 * finds nothing, and the insert returns `INSERTED_OFFER_ID`. Anything else is left unplanned.
 */
export function emptyOffersTable(request: RecordedRequest): Response | undefined {
  if (isOffersRequest(request, "GET") && new URL(request.url).searchParams.has("source_url"))
    return jsonResponse([], 200);
  if (isOffersRequest(request, "POST")) return jsonResponse({ id: INSERTED_OFFER_ID }, 201);
  return undefined;
}

/** True for a request to otodom.pl. */
export function isOtodomRequest(request: RecordedRequest): boolean {
  const host = new URL(request.url).hostname;
  return host === "www.otodom.pl" || host === "otodom.pl";
}
