import { vi } from "vitest";

// The HTTP edge, and only the HTTP edge: tests replace `globalThis.fetch` and nothing inside
// src/ (test-plan.md, anti-patterns — no vi.mock of @/lib/supabase or @/lib/otodom). Both the
// otodom fetch and supabase-js look `fetch` up on the global at call time, so one stub sees
// every request either of them makes.
//
// Every request goes through a handler. A request the handler does not answer is recorded as
// unplanned and rejected; `restoreFetch` then fails the test, because supabase-js and the
// otodom fetch both turn a rejected fetch into an ordinary error result that could otherwise
// pass unnoticed. No test can reach the real network — the model provider included, whose
// requests and answers are described in tests/fixtures/anthropic.ts.

/** One request as the stub saw it. `body` is the raw string that would go on the wire. */
export interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

/** What a handler may know about a request besides what is recorded. */
export interface FetchContext {
  /**
   * The signal the caller passed to `fetch`, if any. A handler that plays a server which never
   * answers, or a body that never ends, ends with this signal's reason once it aborts — which is
   * what a real `fetch` does, and the only way such a request ever finishes.
   */
  signal?: AbortSignal;
}

/** Answers a request, or returns `undefined` for a request the test did not plan. */
export type FetchHandler = (
  request: RecordedRequest,
  context: FetchContext,
) => Response | Promise<Response> | undefined;

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

    const response = await handler(request, { signal: signal ?? undefined });
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

/** What a test may say about a response besides its body. `headers` replace the default `Content-Type`. */
export interface ResponseOptions {
  status?: number;
  url?: string;
  headers?: Record<string, string>;
}

function respond(body: BodyInit | null, { status = 200, url, headers: extra = {} }: ResponseOptions): Response {
  // Set one by one: a second spelling of a name in a plain object would be joined, not replaced.
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  const response = new Response(body, { status, headers });
  if (url !== undefined) Object.defineProperty(response, "url", { value: url });
  return response;
}

/**
 * A `Response` as `fetch` hands it back. `new Response()` leaves `url` as "", which the otodom
 * fetch reads as "no redirect happened"; a test of a followed redirect passes the address the
 * redirect landed on, the way a real fetch reports it.
 */
export function responseAt(body: string | null, options: ResponseOptions = {}): Response {
  return respond(body, options);
}

/**
 * A `Response` whose headers arrived and whose body cannot be read: its stream ends with
 * `error`, so `text()` rejects with it — a connection cut after the status line.
 */
export function unreadableResponse(error: unknown, options: ResponseOptions = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
  return respond(body, options);
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

/** Sits in the challenge page's text. No log entry may carry it: a page's body is never logged. */
export const CHALLENGE_CANARY = "kanarek-wyzwanie-7d3a";

/**
 * An anti-bot interstitial, written by hand — nobody has recorded one from otodom
 * (otodom_fetching.md, sections 2 and 9.1). It carries no `__NEXT_DATA__` script.
 */
export const CHALLENGE_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Chwileczkę…</title></head>' +
  "<body><main><h1>Sprawdzamy, czy nie jesteś automatem</h1>" +
  `<p>To potrwa kilka sekund. Identyfikator sprawdzenia: ${CHALLENGE_CANARY}</p>` +
  '<noscript>Włącz JavaScript, aby przejść dalej.</noscript></main><script src="/challenge.js"></script></body></html>';

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
//
// And as the criteria module (src/lib/criteria.ts) reads the criteria, read from the same file:
//
// - The team's limits with their signature, for `loadCriteria`: `.from("team_criteria")
//   .select("city, price_min, price_max, area_min, updated_at, updated_by").eq("id", true)
//   .maybeSingle()`:
//   `GET <SUPABASE_URL>/rest/v1/team_criteria?select=city,price_min,price_max,area_min,
//   updated_at,updated_by&id=eq.true` — `select` with its whitespace stripped, the boolean
//   written as `true`. `maybeSingle()` is the client-side flag described above: `200 []` becomes
//   `data: null` with no error, which here is the missing singleton row; `[row]` becomes `row`.
// - The limits alone, for `loadTeamLimits`: the same request without the signature columns,
//   `GET <SUPABASE_URL>/rest/v1/team_criteria?select=city,price_min,price_max,area_min&id=eq.true`.
// - Every member's requirements, `.from("member_requirements").select("author_id, body,
//   created_at, updated_at").order("updated_at", { ascending: false })`:
//   `GET <SUPABASE_URL>/rest/v1/member_requirements?select=author_id,body,created_at,updated_at
//   &order=updated_at.desc` — no filter, and `order` with no `nullsfirst`/`nullslast` suffix.
//   PostgREST answers `200` with an array of rows, `[]` when nobody has written any.
// - `loadCriteria` sends the limits read and the requirements read in parallel, so a handler
//   tells them apart by table, never by order. After both, only when there is somebody other than
//   the viewer to name — a requirements author, or whoever last changed the limits — the one
//   "many members" request above. `loadTeamLimits` sends its one request and nothing else.
// - With `maybeSingle()`, a `200` whose body is not an array is handed to the calling code as
//   it came: an object is read as the row itself. A `200` whose requirements body is not an array
//   is what makes `loadCriteria` throw inside; no answer makes `loadTeamLimits` throw.
//
// And as the same module reads the criteria for an audit (`loadAuditCriteria`), read from the
// same file:
//
// - The criteria revision, `.from("criteria_revision").select("revision").eq("id", true)
//   .maybeSingle()`: `GET <SUPABASE_URL>/rest/v1/criteria_revision?select=revision&id=eq.true`.
//   It goes out first and last: once before the criteria and once after them.
// - Between the two, in parallel, the limits alone — the `loadTeamLimits` request above — and
//   the requirements' texts, `.from("member_requirements").select("body").order("created_at",
//   { ascending: true }).order("author_id", { ascending: true })`:
//   `GET <SUPABASE_URL>/rest/v1/member_requirements?select=body&order=created_at.asc,
//   author_id.asc` — a second `order()` is appended to the first after a comma. The author
//   column orders the rows and is not selected.
// - Four requests when the two revisions are equal. When they differ, the same four once more —
//   eight in all — and never a third round. `members` is never asked: nobody is named.
// - A `200` whose requirements body is not an array is read as unreadable rows, not walked, so
//   no answer makes `loadAuditCriteria` throw.
//
// And as the audit settings module (src/lib/audit/settings.ts) and its route
// (src/pages/api/audit-settings.ts) talk to it, read from the same file:
//
// - The team's audit settings with their signature, for `loadAuditSettings`:
//   `.from("audit_settings").select("model, effort, updated_at, updated_by").eq("id", true)
//   .maybeSingle()`:
//   `GET <SUPABASE_URL>/rest/v1/audit_settings?select=model,effort,updated_at,updated_by
//   &id=eq.true`. `maybeSingle()` is the client-side flag described above: `200 []` becomes
//   `data: null` with no error, which here is the missing singleton row; `[row]` becomes `row`,
//   and two rows become an error, `PGRST116`. A `200` whose body is an object is read as the row
//   itself, so no answer makes `loadAuditSettings` throw.
// - After it, only when the row carries a date and a signature that is not the viewer's, the "one
//   member" request above (`resolveSaver`) — none at all for settings never changed, changed by
//   the viewer, or signed by nobody (a deleted account).
// - The save, `.from("audit_settings").update({ model, effort }).eq("id", true).select("id")`:
//   `PATCH <SUPABASE_URL>/rest/v1/audit_settings?id=eq.true&select=id` with
//   `Content-Type: application/json` and `Prefer: return=representation`; the body is
//   `JSON.stringify({ model, effort })`. PostgREST answers `200` with an array of the rows it
//   changed — `[{ "id": true }]`, also when the values were the same as before, or `[]` when RLS
//   filtered the update down to no row, which is not an error. The trigger's refusal of a change
//   it cannot sign answers `403` with `{ "code": "42501", … }`, and a value outside the table's
//   checks `400` with `{ "code": "23514", … }`.

//
// And as the audit route (src/pages/api/audits.ts) and its store (src/lib/audit/store.ts) talk
// to it, read from the same file:
//
// - The offer to audit, `.from("offers").select("<the audit's columns>").eq("id", id)
//   .maybeSingle()`: `GET <SUPABASE_URL>/rest/v1/offers?select=title,description,price,…
//   &id=eq.<id>` — `select` is `AUDIT_OFFER_COLUMNS` joined with commas, nothing else. `200 []`
//   becomes `data: null` with no error (no such offer), `[row]` becomes `row`.
// - After it, the four requests of `loadAuditCriteria` and the one of `loadAuditSettings`
//   described above, in that order. `offer_notes` is never asked.
// - The claim, `.from("offer_audits").insert({ offer_id, run_state: "running" })
//   .select("run_started_at")`: `POST <SUPABASE_URL>/rest/v1/offer_audits?select=run_started_at`
//   with `Prefer: return=representation`; the body is the JSON of that object. Without
//   `single()` PostgREST answers `201` with an array, `[{ "run_started_at": … }]`. An offer that
//   already has a row answers `409` with `{ "code": "23505", … }`.
// - The takeover after that `409`, `.update({ run_state: "running" }).eq("offer_id", id)
//   .select("run_started_at")`: `PATCH <SUPABASE_URL>/rest/v1/offer_audits?offer_id=eq.<id>
//   &select=run_started_at`. `200` with the one row, or `400` with `{ "code": "VP001", … }` —
//   the table's own SQLSTATE — while an attempt younger than 175 seconds holds the row.
// - The two writes that end an attempt, `.update(values).eq("offer_id", id).eq("run_state",
//   "running").eq("run_started_at", startedAt).select("offer_id")`:
//   `PATCH <SUPABASE_URL>/rest/v1/offer_audits?offer_id=eq.<id>&run_state=eq.running
//   &run_started_at=eq.<startedAt>&select=offer_id` — the `+` of the timestamp's offset travels
//   percent-encoded and `URLSearchParams` reads it back. The body's `run_state` tells them
//   apart: `"completed"` with the result's eight columns, or `"failed"` with `run_failure`.
//   `200 [{ "offer_id": … }]` is a write that reached the row; `200 []` is one that reached
//   none, which is not an error. A `PATCH` is never retried by the client: `500` with
//   `{ "code", "message", … }` and a rejected `fetch` (status `0`) both come back at once as a
//   result with `error` set.

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

// Supabase Auth, as the middleware talks to it through `supabase.auth.getUser()` (@supabase/ssr
// 0.12 and auth-js 2.116, read from node_modules/@supabase/ssr/src/cookies.ts,
// node_modules/@supabase/auth-js/src/GoTrueClient.ts and node_modules/@supabase/auth-js/src/lib/fetch.ts):
//
// - The session lives in the request's `Cookie` header under `sb-<ref>-auth-token`, where
//   `<ref>` is the first label of the Supabase host — `sb-supabase-auth-token` for
//   `SUPABASE_TEST_URL`. Its value is `base64-` followed by the session's JSON in base64url; a
//   value over 3180 characters is split into `.0`, `.1`… chunks, which the session here never is.
// - Without that cookie `getUser()` answers `AuthSessionMissingError` and makes no request.
// - With a token that is not within 90 s of `expires_at`: one `GET <SUPABASE_URL>/auth/v1/user`
//   carrying `Authorization: Bearer <access token>`. `200` with the user's JSON is the user. The
//   request is sent once — an answer of any kind, or a rejected `fetch`, is never retried.
// - With a token past `expires_at`, first `POST <SUPABASE_URL>/auth/v1/token?grant_type=refresh_token`
//   with the body `{ "refresh_token": … }`. A refusal (`400`, `refresh_token_not_found`) ends
//   there: no `/user` request follows, the client drops the session from its storage and
//   `getUser()` returns the refusal. The client also writes to the console by itself here: each
//   of its two auth-state listeners calls `console.warn` with the error, message included. A
//   `5xx` or a rejected `fetch` on this request is retried with back-off for about 30 s, so no
//   test here uses one.
// - How an answer that is not `2xx` becomes an error (`handleError` in lib/fetch.ts):
//   - a rejected `fetch` → `AuthRetryableFetchError`, status `0`;
//   - `500`–`504` and `520`–`530` → `AuthRetryableFetchError` with that status, whatever the body;
//   - any other status whose body is not JSON (a paused project's `540` with an HTML page) →
//     `AuthUnknownError`, which has no status and no code;
//   - a JSON body → `AuthApiError` with the response's status and, as its code, the body's
//     `error_code` — except `session_not_found`, which becomes `AuthSessionMissingError`. The
//     body's `msg` becomes the error's message.
// - None of these throws: `getUser()` returns `{ data: { user: null }, error }` for all of them.

/** The member the stubbed Auth knows. Canaries: no log entry may carry the address or a token. */
export const SESSION_USER_ID = "7a2e9d41-5c3b-4f6a-9e1d-00000000cafe";
export const SESSION_USER_EMAIL = "sesja.kanarek@vetpad.local";
export const SESSION_ACCESS_TOKEN = "KANAREK-ACCESS-TOKEN-1f0e";
export const SESSION_REFRESH_TOKEN = "KANAREK-REFRESH-TOKEN-9c7b";

/** The user as `GET /auth/v1/user` answers it. */
export const SESSION_USER = {
  id: SESSION_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: SESSION_USER_EMAIL,
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-09-20T10:00:00.000Z",
};

/** When the session in the cookie expires: an hour from now, an hour ago (`expired`), or `expiresIn` seconds from now. */
export interface SessionCookieOptions {
  expired?: boolean;
  expiresIn?: number;
}

/**
 * The value of the session cookie for `SUPABASE_TEST_URL`, the way `@supabase/ssr` writes it. The
 * access token is an hour from expiry, or an hour past it with `expired` — which makes the
 * client refresh it before anything else. The client also refreshes a token within 90 seconds of
 * its expiry, so `expiresIn` places the refresh at a moment of the test's choosing.
 */
export function sessionCookieValue({ expired = false, expiresIn }: SessionCookieOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: SESSION_ACCESS_TOKEN,
    refresh_token: SESSION_REFRESH_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + (expiresIn ?? (expired ? -3600 : 3600)),
    user: SESSION_USER,
  };
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

/** A `Cookie` header carrying that session. */
export function sessionCookie(options: SessionCookieOptions = {}): string {
  return `sb-supabase-auth-token=${sessionCookieValue(options)}`;
}

/** The tokens Auth hands out when it accepts a refresh. Canaries, like the session's own. */
export const REFRESHED_ACCESS_TOKEN = "KANAREK-ACCESS-TOKEN-ODSWIEZONY-2a4c";
export const REFRESHED_REFRESH_TOKEN = "KANAREK-REFRESH-TOKEN-ODSWIEZONY-6e8f";

/** A granted refresh, as `POST /auth/v1/token?grant_type=refresh_token` answers it: a session an hour from expiry. */
export function refreshedSessionResponse(): Response {
  const now = Math.floor(Date.now() / 1000);
  return jsonResponse(
    {
      access_token: REFRESHED_ACCESS_TOKEN,
      refresh_token: REFRESHED_REFRESH_TOKEN,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user: SESSION_USER,
    },
    200,
  );
}

/** True for a request to the stubbed Supabase Auth: `GET /auth/v1/user` or `POST /auth/v1/token`. */
export function isAuthRequest(request: RecordedRequest, endpoint: "user" | "token"): boolean {
  const url = new URL(request.url);
  return (
    url.origin === SUPABASE_TEST_URL &&
    url.pathname === `/auth/v1/${endpoint}` &&
    request.method === (endpoint === "user" ? "GET" : "POST")
  );
}

/** An error the way Supabase Auth sends one: the HTTP status as `code`, the reason as `error_code`. */
export function authErrorResponse(status: number, errorCode: string, msg: string): Response {
  return jsonResponse({ code: status, error_code: errorCode, msg }, status);
}

/** True for a request to otodom.pl. */
export function isOtodomRequest(request: RecordedRequest): boolean {
  const host = new URL(request.url).hostname;
  return host === "www.otodom.pl" || host === "otodom.pl";
}
