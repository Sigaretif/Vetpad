// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// that registration is closed both in the app and in Supabase Auth (FR-001), and that /api/offers refuses
// anonymous callers and URLs that are not otodom.pl offers before any request reaches otodom.pl.
// Signed in, it checks that the offer board on /dashboard reads offers for the default, price, area and an unknown
// sort: each must answer 200 with data-board-state="ok" in the body, because a broken board query also renders
// with 200 (as data-board-state="error") and only the marker tells it apart from an empty board.
// Straight against Supabase, it checks that public.members is gated by row-level security in both directions: the
// publishable key alone reads no rows, a signed-in member reads at least one. RLS denial answers 200 with an empty
// array, so only the row count tells a blocked read from a working one.
// Member notes (FR-009, FR-012, FR-013, FR-015): it creates two fixture offers as the first seeded member straight in
// public.offers (never through otodom.pl), then checks that /api/notes turns away anonymous users, non-form bodies,
// unknown offers and a blank note, saves and edits the member's note, and that the offer card shows it with
// data-notes-state="ok". Both members (the second is SMOKE_EMAIL_2) then hold a note on each fixture offer, and
// every write after that is judged by whole rows: withSnapshot reads the observed notes with every column, dates
// included, before and after the step, and two control steps prove that it reports a change (an edited text, and a
// re-save that moves only the date). Against public.offer_notes: one note per member per offer, the publishable
// key alone reads none and inserts none (401, 42501), and the second member reads the first member's note but
// cannot edit or delete it (200 with no rows), nor insert or upsert a note in the first member's name (403, 42501)
// - the note is the same row after each attempt. A denied delete sent without `Prefer` (the first member's, of the
// second member's note) answers 204, exactly as a successful one would, so there the unchanged row is the only proof. A write that does succeed stays on its own
// row: the second member's PATCH and DELETE filtered by the offer alone reach both members' notes and touch one.
// The author's own PATCH of the note's offer, author, id and dates is undone by the triggers (the dates are always
// the database's) and leaves the other member's note alone. Against public.offers: the second member rewrites the
// listing data of an offer the first one saved, as a re-fetch would, and every note on both offers is the same row
// afterwards; the offer's author survives being reassigned and being cleared, read back with a filter rather than
// from the PATCH's answer. Deleting the first fixture offer as the second member takes both members' notes with it
// and nothing from the second offer; the second offer follows, and a last delete of both ids leaves nothing behind
// whatever failed in between. Because it writes and deletes offers, it never runs against production.
// Team criteria (FR-002, FR-003): /criteria, /api/criteria and /api/requirements turn anonymous users away, and the
// publishable key alone reads nothing from public.team_criteria, public.criteria_revision or public.member_requirements
// nor changes the limits. Signed in, it reads the limits as they stood before the run, saves limits of its own
// (refusing a reversed price range), saves and edits the member's requirements (refusing blank ones; the edit is
// the control step for requirements - the member's own row is observed and must be reported as changed), and finds
// both on /criteria with data-criteria-state="ok"; every error redirect names its form (`&form=`). The revision
// counter is read around each save: it grows by one on a real change and stays put on a refused save or on
// re-saving the same limits. The fixture offer gets a PLN price above the saved ceiling, and its row on /dashboard
// carries data-limit-breach="price_above" under data-limits-state="ok". `intent=clear` leaves four empty limits.
// Unknown values last (prd.md, Guardrails): by then the first fixture offer states a price and no area, and the
// second gets an area and has no price. On /dashboard the two rows are compared by position, for `sort=price` and
// `sort=area` in `asc` and `desc`: the offer that states the value stands above the one that does not, in both
// directions. The roles swap between the two sorts, so a board that kept one fixed order cannot pass all four, and
// `desc` is the direction that turns red when the query loses `nullsFirst: false`. A row missing from the board
// fails the step.
// Against Supabase: nobody inserts or deletes the team_criteria row or writes the counter (0 rows / 42501), and a
// limit the form would refuse (a fractional price) is refused by the table's check too (23514). Requirements are
// judged by whole rows, as notes are: the second member reads the first member's requirements but cannot edit them
// (200 with no rows), nor insert or upsert requirements in the first member's name (403, 42501), and the first
// member cannot delete the second member's - the observed row is the same after each attempt. A write that does
// succeed stays on its own row: a PATCH and a DELETE whose filter names both authors each touch one row and leave
// the other member's as it was; the second member then saves theirs again. A member's PATCH of the limits'
// signature, date and id, or of their own requirements' author and dates, is accepted and undone by the triggers,
// with no revision bump. The second member's requirements are the same row after everything the first member does
// next to them: the identity patch, the delete through the route, the limits clear and the limits restore.
// AI audit (FR-010, FR-011), straight against Supabase and never near a model provider: the publishable key alone
// reads nothing from public.audit_settings or public.offer_audits, changes no setting and starts no attempt (401,
// 42501). A member reads the settings as they stood before the run; nobody inserts or deletes the settings row (403
// with 42501, 200 with no rows). The settings are judged by the whole row, as notes are: a member's change of the
// model is the control step - the row must be reported as changed, and is then signed by that member - while their
// PATCH of the signature, the date and the id is accepted and leaves the row as it was. On the second fixture offer
// the first member starts an audit attempt, naming the second member as its starter and auditor and sending a date
// and findings of their own: the stored attempt is signed and dated by the database and holds no result. The second
// member reads it but cannot take it over while it runs (400 with the table's own SQLSTATE, VP001), and its starter
// cannot delete it (200 with no rows) - the row is the same after each, and failing the attempt is the control step
// for that comparison. The first fixture offer is left without an attempt for the whole run: it is the offer whose
// card must read as never audited. Deleting the second fixture offer takes the attempt with it.
// The audit settings through the app (FR-010): /api/audit-settings turns an anonymous caller away, and a forged
// session too. Signed in, it refuses a body that is not a form, a model outside the list and an effort outside the
// list - each lands back on /criteria naming its form (`&form=audit#audyt`), and the settings row is the same
// afterwards. Saving a model and an effort the row did not hold is the control step for the route: the row must be
// reported as changed, and is then read back holding both values, signed by the member. /criteria shows them under
// data-audit-settings-state="ok", as data-audit-model and data-audit-effort on the same section, and saving the same
// values again leaves the whole row - signature and date included - as it was.
// The audit itself through the app (FR-010): POST /api/audits turns an anonymous caller away, and a forged session
// too - a redirect to /auth/signin, the only one the route makes. Signed in, every other answer is 200 with an NDJSON
// stream whose last line says how the audit ended: an id that is not a uuid ends as `invalid_offer`, an offer that
// does not exist as `offer_not_found`. Both are decided before the route looks for a provider key, so they read
// the same in CI, which has no key, and on a machine whose .env holds one. That is as far as smoke goes: it never
// sends an audit request for an offer that exists, so no step can reach the model provider and none can cost
// anything - the helper refuses the two fixture offers' ids outright. What a real audit does is covered against a
// stubbed provider in tests/pages/api/audits.test.ts.
// The audit on the card and the board (FR-006, FR-010), read from the pages and never run: the card of the first
// fixture offer, which never gets an attempt, carries data-audit-state="none" - whatever data-audit-available says
// beside it, since CI has no provider key and a local run may have one. The card of the second fixture offer is the
// control for that marker: it carries "running" while the attempt this run started is fresh, and "failed" once the
// control step has failed it, so a card that said "none" about every offer cannot pass. /dashboard carries
// data-audits-state="ok", because a failed read of the audits renders with 200 too, and the first fixture offer's row
// reads „Nie audytowano" - a running or failed attempt on another offer audits nothing.
// Cleanup runs whatever failed before it: the limits read at the start are written back (signed by the first
// member, as any restore would be), the audit settings read at the start likewise, and both members' requirements
// are deleted with the rows counted - none left of the first member's, which the route removed, and one of the
// second member's, which must have lasted until then.
// A session Auth refuses is a sign-out, never an outage (src/middleware.ts): before signing in, it sends a forged
// session cookie - named after the SUPABASE_URL host, with a token that has not expired and a signature that is not
// real - on GET /dashboard, on POST /api/offers, on POST /api/audit-settings and on POST /api/audits, and each must
// redirect to /auth/signin, not answer with the 503 page. The cookie goes instead of the cookie jar and nothing the server
// answers is stored in it. An outage itself cannot be played against a live Auth; tests/middleware.test.ts covers
// it. The error pages answer under their own addresses with their own status and marker: /503 with 503 and
// data-error-page="503", /500 with 500 and data-error-page="500".
// It also checks that the dev-only kitchen sinks /dev/offer-card, /dev/forms, /dev/board, /dev/criteria and /dev/errors answer 404: in CI this runs
// against the production preview, where the pages must not exist (on `npm run dev` those steps fail by design).
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 npm run smoke

import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { URL } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
// Smoke writes a fixture offer and a note and deletes them again, so it refuses a Supabase that is not on this
// machine unless the caller opts in with SMOKE_ALLOW_REMOTE=1. CI's smoke job starts a local Supabase.
if (SUPABASE_URL && process.env.SMOKE_ALLOW_REMOTE !== "1") {
  const { hostname } = new URL(SUPABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    console.error(
      `Refusing to run against ${hostname}: smoke writes and deletes data. Set SMOKE_ALLOW_REMOTE=1 to override.`,
    );
    process.exit(1);
  }
}
// Default credentials are the first and second team accounts seeded by supabase/seed.sql (local database only).
const email = process.env.SMOKE_EMAIL ?? "sigaretif1@vetpad.local";
const password = process.env.SMOKE_PASSWORD ?? "qwerty123456";
const MEMBER = { email, password };
const OTHER_MEMBER = {
  email: process.env.SMOKE_EMAIL_2 ?? "sigaretif2@vetpad.local",
  password: process.env.SMOKE_PASSWORD_2 ?? "qwerty123456",
};
const jar = new Map();
// The board's marker for a successful read (list or empty); a failed read renders data-board-state="error".
const BOARD_OK = 'data-board-state="ok"';
const MISSING_SUPABASE = "SUPABASE_URL and SUPABASE_KEY must be set (e.g. in .env)";
// The notes' marker for a successful read; a failed read renders data-notes-state="error".
const NOTES_OK = 'data-notes-state="ok"';
// The offer this run creates (and deletes) to hang notes on; its id is chosen here so every step can name it.
const FIXTURE_OFFER_ID = randomUUID();
const FIXTURE_CARD = `/offers/${FIXTURE_OFFER_ID}`;
const FIXTURE_OFFER = `offers?id=eq.${FIXTURE_OFFER_ID}`;
const FIXTURE_NOTES = `offer_notes?offer_id=eq.${FIXTURE_OFFER_ID}`;
// A second fixture offer, so a step can ask whether a write or a delete on the first took anything from another.
const FIXTURE_OFFER_ID_2 = randomUUID();
const FIXTURE_OFFER_2 = `offers?id=eq.${FIXTURE_OFFER_ID_2}`;
const FIXTURE_NOTES_2 = `offer_notes?offer_id=eq.${FIXTURE_OFFER_ID_2}`;
const FIXTURE_OFFERS = `offers?id=in.(${FIXTURE_OFFER_ID},${FIXTURE_OFFER_ID_2})`;
// Every note on either fixture offer, whoever wrote it.
const ALL_FIXTURE_NOTES = `offer_notes?offer_id=in.(${FIXTURE_OFFER_ID},${FIXTURE_OFFER_ID_2})`;
// The saved note's text, first as written and then as edited: the card must show the edited one.
const NOTE_FIRST = `smoke-note-${FIXTURE_OFFER_ID}-first`;
const NOTE_EDITED = `smoke-note-${FIXTURE_OFFER_ID}-edited`;
// What the control steps write into the first member's note, to prove that the row comparison sees a change.
const NOTE_CONTROL = `smoke-note-${FIXTURE_OFFER_ID}-control`;
// An id the author tries to give the note; the freeze trigger must keep the database's own.
const FORGED_NOTE_ID = randomUUID();
// The criteria page's and the board's markers for a successful read; a failed read renders "error".
const CRITERIA_OK = 'data-criteria-state="ok"';
const LIMITS_OK = 'data-limits-state="ok"';
// Limits this run saves. The city is new on every run, so saving it is always a real change of the limits.
const SMOKE_CITY = `smoke-miasto-${FIXTURE_OFFER_ID.slice(0, 8)}`;
const SMOKE_PRICE_MAX = 500000;
const LIMIT_COLUMNS = "city,price_min,price_max,area_min";
// The first member's requirements as written, as edited and as rewritten by the PATCH that names both authors, and
// the second member's own.
const REQUIREMENTS_FIRST = `smoke-wymagania-${FIXTURE_OFFER_ID}-first`;
const REQUIREMENTS_EDITED = `smoke-wymagania-${FIXTURE_OFFER_ID}-edited`;
const REQUIREMENTS_WIDE = `smoke-wymagania-${FIXTURE_OFFER_ID}-wide`;
const REQUIREMENTS_OTHER = `smoke-wymagania-${FIXTURE_OFFER_ID}-other`;
// The shared limits as they stood before this run, read by the first criteria step and written back by cleanup.
let limitsBefore = null;
// The team's audit settings: one row, and the two models its check admits (public.audit_settings).
const AUDIT_SETTINGS = "audit_settings?id=eq.true";
const AUDIT_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];
// The three efforts its other check admits.
const AUDIT_EFFORTS = ["low", "medium", "high"];
// The audit settings section's marker for a successful read on /criteria; a failed read renders "error".
const AUDIT_SETTINGS_OK = 'data-audit-settings-state="ok"';
// The audit settings as they stood before this run, read before the first write and written back by cleanup.
let auditSettingsBefore = null;
// The audit attempt this run starts hangs on the second fixture offer. The first one - the offer behind FIXTURE_CARD,
// whose card the run opens - never gets an audit row, so a step that reads that card sees an offer nobody audited.
const FIXTURE_AUDIT = `offer_audits?offer_id=eq.${FIXTURE_OFFER_ID}`;
const FIXTURE_AUDIT_2 = `offer_audits?offer_id=eq.${FIXTURE_OFFER_ID_2}`;
// The second fixture offer's card: the one whose audit section has an attempt to show.
const FIXTURE_CARD_2 = `/offers/${FIXTURE_OFFER_ID_2}`;
// What the card's audit section says about the audit's data (src/lib/audit/store.ts, auditDataState). A failed
// read renders "error"; whether a provider key exists is a separate attribute, data-audit-available.
const AUDIT_NONE = 'data-audit-state="none"';
const AUDIT_RUNNING = 'data-audit-state="running"';
const AUDIT_FAILED = 'data-audit-state="failed"';
// The board's marker for a successful read of the audits; a failed read renders data-audits-state="error".
const AUDITS_OK = 'data-audits-state="ok"';
// What POST /api/audits answers with whenever it does not redirect: one JSON object per line.
const AUDIT_STREAM_TYPE = "application/x-ndjson; charset=utf-8";

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

// `cookie` replaces the cookie jar for one request: it is sent instead of the jar, and nothing the server sets in
// its answer is stored.
async function request(path, { method = "GET", form, json, cookie } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookie ?? cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
  });
  if (cookie === undefined) storeCookies(response);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

// A session cookie the way @supabase/ssr writes one: `sb-<first label of the Supabase host>-auth-token`, holding
// `base64-` and the session's JSON in base64url. The access token is shaped like a JWT that expires in an hour, so
// the client asks Auth for the user at once instead of refreshing first - and its signature is random bytes, so
// Auth refuses it. The app must read SUPABASE_URL with the same host as this script, or it looks for the session
// under another name and sees an anonymous visitor.
function forgedSessionCookie() {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: randomUUID(), aud: "authenticated", role: "authenticated" };
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: user.id, aud: user.aud, role: user.role, iat: now, exp: now + 3600 }),
    randomBytes(32).toString("base64url"),
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: randomBytes(12).toString("base64url"),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  return `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token=base64-${encode(session)}`;
}

// One request carrying the forged session instead of the cookie jar.
function requestWithForgedSession(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { status: 0, location: "", error: MISSING_SUPABASE };
  return request(path, { ...options, cookie: forgedSessionCookie() });
}

async function supabaseSignup() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { status: 0, location: "", error: MISSING_SUPABASE };
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `smoke-${Date.now()}@example.com`, password: "Smoke-Test-Passw0rd!" }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, location: "", errorCode: body.error_code ?? "" };
}

// Supabase sessions by email, so each seeded account signs in to Supabase Auth once per run.
const sessions = new Map();

async function supabaseSession(account) {
  if (sessions.has(account.email)) return sessions.get(account.email);
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const session = await auth.json().catch(() => ({}));
  if (!session.access_token || !session.user?.id) return { error: `no session for ${account.email} (${auth.status})` };
  const result = { token: session.access_token, userId: session.user.id };
  sessions.set(account.email, result);
  return result;
}

// Calls the Data API (PostgREST) with the publishable key alone, or as a seeded account (`as`). Reports the row
// count, because row-level security denies a read, an update and a delete with 200 and `[]`, not an error; a
// blocked insert answers 403 with PostgREST's `code` 42501 (not Auth's `error_code`, which supabaseSignup reads).
async function supabaseRest(path, { as, method = "GET", body, prefer } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { status: 0, location: "", error: MISSING_SUPABASE };
  const headers = { apikey: SUPABASE_KEY };
  if (as) {
    const session = await supabaseSession(as);
    if (session.error) return { status: 0, location: "", error: session.error };
    headers.Authorization = `Bearer ${session.token}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: only the status counts.
  }
  return {
    status: response.status,
    location: "",
    body: text,
    rows: Array.isArray(parsed) ? parsed.length : undefined,
    errorCode: parsed && !Array.isArray(parsed) && typeof parsed.code === "string" ? parsed.code : undefined,
  };
}

// The seeded member's uid, for columns row-level security compares with auth.uid().
async function memberId(account) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { error: MISSING_SUPABASE };
  return supabaseSession(account);
}

// Reads public.members over the Data API: with the publishable key alone, or with a member's session token.
function supabaseMembers({ signedIn }) {
  return supabaseRest("members?select=id", { as: signedIn ? MEMBER : undefined });
}

// Creates a fixture offer as the first member, in the shape /api/offers would save — but with nothing fetched.
async function createFixtureOffer(offerId) {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest("offers", {
    as: MEMBER,
    method: "POST",
    prefer: "return=representation",
    body: {
      id: offerId,
      created_by: member.userId,
      otodom_id: Math.floor(Math.random() * 2 ** 48),
      source_url: `https://example.com/smoke/${offerId}`,
      title: "Smoke: oferta testowa",
      description: "Oferta utworzona przez scripts/smoke.mjs i usuwana na końcu przebiegu.",
      raw: {},
    },
  });
}

// The Data API path of one member's note (`author`) on one offer. Throws when the member's uid cannot be read,
// which fails the step that asked for it.
async function notePath(author, offerId) {
  const member = await memberId(author);
  if (member.error) throw new Error(member.error);
  return `offer_notes?offer_id=eq.${offerId}&author_id=eq.${member.userId}`;
}

// One member's note (`author`) on a fixture offer over the Data API, as `as` or with the publishable key alone.
// Since both members hold a note on each fixture offer, a step about one note names its author.
async function noteRest(author, { offerId = FIXTURE_OFFER_ID, select, ...options } = {}) {
  const path = await notePath(author, offerId);
  return supabaseRest(select ? `${path}&select=${select}` : path, options);
}

// A member writes a note of their own on a fixture offer straight through the Data API.
async function createNote(author, offerId) {
  const member = await memberId(author);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest("offer_notes", {
    as: author,
    method: "POST",
    prefer: "return=representation",
    body: { offer_id: offerId, author_id: member.userId, pros: `smoke-note-${offerId}-${author.email}` },
  });
}

// An observed read for withSnapshot: one member's note on one offer, read by its author.
function observedNote(author, offerId = FIXTURE_OFFER_ID) {
  return { as: author, order: "id", path: () => notePath(author, offerId) };
}

// An observed read for withSnapshot: every note under a path (an offer's, or both fixture offers'), read by the
// first member, who reads every member's notes.
function observedNotes(path) {
  return { as: MEMBER, order: "id", path };
}

// The second member tries to write a note signed with the first member's uid, on the fixture offer where the first
// member already has one: a plain insert, or the upsert /api/notes saves with, which would replace that note.
async function forgeNote({ upsert }) {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(upsert ? "offer_notes?on_conflict=offer_id,author_id" : "offer_notes", {
    as: OTHER_MEMBER,
    method: "POST",
    prefer: upsert ? "resolution=merge-duplicates" : undefined,
    body: { offer_id: FIXTURE_OFFER_ID, author_id: member.userId, pros: "smoke: podszywanie się" },
  });
}

// The second member writes to the first fixture offer, which the first member saved. Any member may (flat roles).
function patchOfferAsOther(body) {
  return supabaseRest(FIXTURE_OFFER, { as: OTHER_MEMBER, method: "PATCH", prefer: "return=representation", body });
}

// The second member rewrites the columns a re-fetch (FR-009) would, and claims the offer while at it. Stands in for
// S-09's route, which does not exist yet: it guards the schema, not that route.
async function rewriteListingAsOther() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return patchOfferAsOther({
    title: "Smoke: oferta testowa po ponownym pobraniu",
    description: "Opis zmieniony przez scripts/smoke.mjs, tak jak zmieniłoby go ponowne pobranie ogłoszenia.",
    price: SMOKE_PRICE_MAX - 1,
    fetched_at: new Date().toISOString(),
    created_by: other.userId,
  });
}

// The first fixture offer, read only if the first member is still its author: a separate read, because the PATCH's
// own answer is not where the stored author is checked.
async function offerStillByMember() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(`${FIXTURE_OFFER}&created_by=eq.${member.userId}&select=id`, { as: MEMBER });
}

// The notes on the first fixture offer written by the two members: one row each when both are there.
async function bothMembersNotes() {
  const [member, other] = [await memberId(MEMBER), await memberId(OTHER_MEMBER)];
  if (member.error || other.error) return { status: 0, location: "", error: member.error ?? other.error };
  return supabaseRest(`${FIXTURE_NOTES}&author_id=in.(${member.userId},${other.userId})&select=id`, { as: MEMBER });
}

// The author tries to move their note to another offer, hand it to the second member, re-id it and date it
// themselves. RLS allows the update (it is their note); the triggers must keep all of that from the stored row.
async function patchNoteIdentity() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return supabaseRest(FIXTURE_NOTES, {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: {
      id: FORGED_NOTE_ID,
      offer_id: randomUUID(),
      author_id: other.userId,
      created_at: "2000-01-01T00:00:00Z",
      updated_at: "2099-01-01T00:00:00Z",
    },
  });
}

// The note as the author sees it after that attempt: still theirs, on the fixture offer, under its own id, with
// dates the database set.
async function noteIdentityAfterPatch() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(
    `${FIXTURE_NOTES}&author_id=eq.${member.userId}&id=neq.${FORGED_NOTE_ID}` +
      "&created_at=gt.2001-01-01&updated_at=lt.2098-01-01&select=id",
    { as: MEMBER },
  );
}

// A member re-signs the limits for the second member, dates them and re-ids the row, changing no limit. RLS allows
// the update (any member edits the limits); the signature trigger must keep the stored signature, date and id.
async function patchLimitsSignature() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return supabaseRest("team_criteria?id=eq.true", {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: { id: false, updated_by: other.userId, updated_at: "2099-01-01T00:00:00Z" },
  });
}

// The limits after that attempt: still signed by the member whose save changed them last, dated by the database.
async function limitsSignatureAfterPatch() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(`team_criteria?id=eq.true&updated_by=eq.${member.userId}&updated_at=lt.2098-01-01&select=id`, {
    as: MEMBER,
  });
}

// The author hands their requirements to the second member and dates them themselves. RLS allows the update (they
// are theirs); the triggers must keep the author and the database's dates.
async function patchRequirementsIdentity() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return requirementsRest(MEMBER, {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: { author_id: other.userId, created_at: "2000-01-01T00:00:00Z", updated_at: "2099-01-01T00:00:00Z" },
  });
}

// The requirements after that attempt: still the author's, with dates the database set.
async function requirementsIdentityAfterPatch() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(
    `member_requirements?author_id=eq.${member.userId}&created_at=gt.2001-01-01&updated_at=lt.2098-01-01` +
      "&select=author_id",
    { as: MEMBER },
  );
}

// The criteria revision (public.criteria_revision) as a member reads it. Throws when it cannot be read, which
// fails the step that asked for it.
async function readRevision() {
  const response = await supabaseRest("criteria_revision?select=revision", { as: MEMBER });
  if (response.error) throw new Error(response.error);
  const [row] = response.rows === 1 ? JSON.parse(response.body) : [];
  if (response.status !== 200 || row === undefined) {
    throw new Error(`criteria revision unreadable (${response.status}, ${response.rows ?? 0} row(s))`);
  }
  return Number(row.revision);
}

// Runs one request between two reads of the revision, and reports by how much the revision moved.
async function withRevision(run) {
  const before = await readRevision();
  const result = await run();
  const after = await readRevision();
  return { ...result, revisionDelta: after - before };
}

// Reads every observed row whole (`select=*`, so dates included) in a fixed order. An observed read is
// `{ path, as, order }`: a Data API path that already carries its filter (a string, or a function resolving to
// one), the account that reads, and the column to order by. Throws when a read fails or, with `requireRows`, when
// one finds no row — which fails the step that asked for it.
async function readSnapshot(observed, { requireRows }) {
  const bodies = [];
  let rows = 0;
  for (const { path, as, order } of observed) {
    const filter = typeof path === "function" ? await path() : path;
    const response = await supabaseRest(`${filter}&select=*&order=${order}`, { as });
    if (response.error) throw new Error(response.error);
    if (response.status !== 200 || response.rows === undefined) {
      throw new Error(`observed rows unreadable (${response.status}): ${filter}`);
    }
    if (requireRows && response.rows === 0) throw new Error(`nothing to observe before the step: ${filter}`);
    bodies.push(response.body);
    rows += response.rows;
  }
  return { rows, bodies: JSON.stringify(bodies) };
}

// Runs one step between two reads of the observed rows, and reports whether every row is the same afterwards,
// column for column. An empty read before the step is an error, never "same": it would prove nothing. Composes
// with withRevision in either order. `runUnobserved` is for a cleanup step: the step still fails when there is
// nothing to observe, but only after `run` has done its work.
async function withSnapshot(observed, run, { runUnobserved = false } = {}) {
  const before = await readSnapshot(observed, { requireRows: true }).catch(async (error) => {
    if (runUnobserved) await run();
    throw error;
  });
  const result = await run();
  const after = await readSnapshot(observed, { requireRows: false });
  return { ...result, snapshot: before.bodies === after.bodies ? "same" : "changed", snapshotRows: before.rows };
}

// Reads the shared limits as a member and keeps them for cleanup to write back.
async function readLimitsBefore() {
  const response = await supabaseRest(`team_criteria?select=${LIMIT_COLUMNS}`, { as: MEMBER });
  if (response.status === 200 && response.rows === 1) [limitsBefore] = JSON.parse(response.body);
  return response;
}

// Writes back the limits read at the start. The signature trigger signs the row with the first member whenever
// that changes a value; who set the limits before the run cannot be restored, only what they were.
function restoreLimits() {
  if (limitsBefore === null) {
    return { status: 0, location: "", error: "the limits were never read at the start, so they cannot be restored" };
  }
  return supabaseRest("team_criteria?id=eq.true", {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: limitsBefore,
  });
}

// The Data API path of one member's requirements (`owner`). Throws when the member's uid cannot be read, which
// fails the step that asked for it.
async function requirementsPath(owner) {
  const author = await memberId(owner);
  if (author.error) throw new Error(author.error);
  return `member_requirements?author_id=eq.${author.userId}`;
}

// The Data API path of both members' requirements at once: the filter a write uses to reach past its own row.
async function bothRequirementsPath() {
  const [member, other] = [await memberId(MEMBER), await memberId(OTHER_MEMBER)];
  if (member.error || other.error) throw new Error(member.error ?? other.error);
  return `member_requirements?author_id=in.(${member.userId},${other.userId})`;
}

// One member's requirements (`owner`) over the Data API, as `as` or with the publishable key alone. A read
// selects the body, so a step can look for the text.
async function requirementsRest(owner, { method = "GET", ...options } = {}) {
  const path = await requirementsPath(owner);
  return supabaseRest(method === "GET" ? `${path}&select=body` : path, { method, ...options });
}

// An observed read for withSnapshot: one member's requirements, read by their author. The table's key is the
// author, so that is what the read is ordered by.
function observedRequirements(owner) {
  return { as: owner, order: "author_id", path: () => requirementsPath(owner) };
}

// The second member saves requirements of their own straight through the Data API, as an upsert: the insert
// policy admits an author writing their own row, and the first member's /criteria then shows them. PostgREST
// answers 201 when the upsert inserts and 200 when it replaces requirements the account already had (a local
// database a person has used); cleanup deletes them either way.
async function saveOtherRequirements() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return supabaseRest("member_requirements?on_conflict=author_id", {
    as: OTHER_MEMBER,
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: { author_id: other.userId, body: REQUIREMENTS_OTHER },
  });
}

// The second member tries to write requirements signed with the first member's uid, while the first member has
// theirs: a plain insert, or the upsert /api/requirements saves with, which would replace them.
async function forgeRequirements({ upsert }) {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(upsert ? "member_requirements?on_conflict=author_id" : "member_requirements", {
    as: OTHER_MEMBER,
    method: "POST",
    prefer: upsert ? "resolution=merge-duplicates" : undefined,
    body: { author_id: member.userId, body: "smoke: podszywanie się" },
  });
}

// A member writes to both members' requirements with one request. The policies must let through only their own.
async function writeBothRequirements(as, options) {
  return supabaseRest(await bothRequirementsPath(), { as, prefer: "return=representation", ...options });
}

// Reads the team's audit settings as a member and keeps them for cleanup to write back.
async function readAuditSettingsBefore() {
  const response = await supabaseRest(`${AUDIT_SETTINGS}&select=model,effort`, { as: MEMBER });
  if (response.status === 200 && response.rows === 1) [auditSettingsBefore] = JSON.parse(response.body);
  return response;
}

// An observed read for withSnapshot: the audit settings row, its signature and date included.
function observedAuditSettings() {
  return { as: MEMBER, order: "id", path: AUDIT_SETTINGS };
}

// A member switches the audit model to the one the settings did not hold at the start, so the write is a real
// change whatever the local database held, and the signature trigger signs it.
function changeAuditModel() {
  if (auditSettingsBefore === null) {
    return {
      status: 0,
      location: "",
      error: "the audit settings were never read at the start, so no other model is known",
    };
  }
  return supabaseRest(AUDIT_SETTINGS, {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: { model: AUDIT_MODELS.find((model) => model !== auditSettingsBefore.model) },
  });
}

// The audit settings, read only if the first member signed them: a separate read, because the PATCH's own answer
// is not where the stored signature is checked.
async function auditSettingsSignedByMember() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(`${AUDIT_SETTINGS}&updated_by=eq.${member.userId}&select=id`, { as: MEMBER });
}

// A member re-signs the audit settings for the second member, dates them and re-ids the row, changing no setting.
// RLS allows the update (any member changes the settings); the signature trigger must keep the stored signature,
// date and id.
async function patchAuditSettingsSignature() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return supabaseRest(AUDIT_SETTINGS, {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: { id: false, updated_by: other.userId, updated_at: "2099-01-01T00:00:00Z" },
  });
}

// The model and the effort this run saves through /api/audit-settings: the model the settings held at the start,
// which the control step above has switched away from by then, and an effort they did not hold. So the save is a
// real change of the row whatever the local database held, and cleanup still writes back what was read. Throws
// when the settings were never read, which fails the step that asked for it.
function formAuditSettings() {
  if (auditSettingsBefore === null) {
    throw new Error("the audit settings were never read at the start, so no other values are known");
  }
  return {
    model: auditSettingsBefore.model,
    effort: AUDIT_EFFORTS.find((effort) => effort !== auditSettingsBefore.effort),
  };
}

// A member saves those settings the way the form on /criteria does.
function saveAuditSettingsThroughForm() {
  return request("/api/audit-settings", { method: "POST", form: formAuditSettings() });
}

// The audit settings, read only if they hold what the form saved and the first member signed them: a separate
// read, because a redirect says nothing about the stored row.
async function auditSettingsAsSavedThroughForm() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  const { model, effort } = formAuditSettings();
  return supabaseRest(
    `${AUDIT_SETTINGS}&model=eq.${model}&effort=eq.${effort}&updated_by=eq.${member.userId}&select=id`,
    { as: MEMBER },
  );
}

// /criteria as the member sees it after that save. The settings section names the stored model and effort in its
// own attributes, so the page is checked for the values the form sent and not for a label. Throws when either is
// missing, which fails the step that asked for it.
async function criteriaAfterAuditSettingsSave() {
  const { model, effort } = formAuditSettings();
  const response = await request("/criteria");
  const missing = [`data-audit-model="${model}"`, `data-audit-effort="${effort}"`].filter(
    (marker) => !response.body.includes(marker),
  );
  if (missing.length > 0) throw new Error(`/criteria does not carry ${missing.join(" or ")} (${response.status})`);
  return response;
}

// Writes back the audit settings read at the start. As with the limits, the trigger signs the row with the first
// member whenever that changes a value; who chose the settings before the run cannot be restored, only what they
// were.
function restoreAuditSettings() {
  if (auditSettingsBefore === null) {
    return {
      status: 0,
      location: "",
      error: "the audit settings were never read at the start, so they cannot be restored",
    };
  }
  return supabaseRest(AUDIT_SETTINGS, {
    as: MEMBER,
    method: "PATCH",
    prefer: "return=representation",
    body: auditSettingsBefore,
  });
}

// The first member starts an audit attempt on the second fixture offer, and claims the rest while at it: the second
// member as the starter and the auditor, a start and an audit date of their own, and findings. The insert trigger
// must keep none of that.
async function startAuditAttempt() {
  const other = await memberId(OTHER_MEMBER);
  if (other.error) return { status: 0, location: "", error: other.error };
  return supabaseRest("offer_audits", {
    as: MEMBER,
    method: "POST",
    prefer: "return=representation",
    body: {
      offer_id: FIXTURE_OFFER_ID_2,
      run_state: "running",
      run_started_by: other.userId,
      run_started_at: "2000-01-01T00:00:00Z",
      audited_by: other.userId,
      audited_at: "2000-01-01T00:00:00Z",
      findings: { forged: true },
    },
  });
}

// The attempt as stored after that insert: running, started by the member who sent it, dated by the database, and
// with no result, auditor or audit date.
async function auditAttemptAsStored() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest(
    `${FIXTURE_AUDIT_2}&run_state=eq.running&run_started_by=eq.${member.userId}&run_started_at=gt.2001-01-01` +
      "&findings=is.null&audited_by=is.null&audited_at=is.null&select=offer_id",
    { as: MEMBER },
  );
}

// An observed read for withSnapshot: the audit row of the second fixture offer, read by the first member, who
// reads every audit. The table's key is the offer, so that is what the read is ordered by.
function observedAudit() {
  return { as: MEMBER, order: "offer_id", path: FIXTURE_AUDIT_2 };
}

// A signed-in member asks for an audit of an offer that cannot be audited, and the answer's last line is read: how
// the audit ended, as `auditEnded` - the reason of a `failed` line, or "done". Smoke never asks for an audit of an
// offer that exists: such a request would go on to the model provider wherever a key is configured, and that call
// is paid for. The two fixture offers are therefore refused here, before anything is sent. Throws when the answer
// is a 200 that is not the stream the route promises, which fails the step that asked for it.
async function requestAuditOfMissingOffer(offerId) {
  if (offerId === FIXTURE_OFFER_ID || offerId === FIXTURE_OFFER_ID_2) {
    throw new Error("smoke never requests an audit of an existing offer: it could reach the model provider");
  }
  const response = await request("/api/audits", { method: "POST", form: { offer_id: offerId } });
  if (response.status !== 200) return response;
  if (response.contentType !== AUDIT_STREAM_TYPE) {
    throw new Error(`the audit answered 200 with ${response.contentType || "no content type"}, not NDJSON`);
  }
  const lines = response.body
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  const last = lines.at(-1);
  if (last?.type !== "done" && last?.type !== "failed") {
    throw new Error("the audit's answer does not end with a `done` or a `failed` line");
  }
  return { ...response, auditEnded: last.type === "failed" ? last.reason : "done" };
}

// The fixture offer's row on /dashboard: from its link to the link's end, so a mark on another offer (the local
// database may hold real ones) cannot pass for the fixture's. No row is an empty body.
async function fixtureBoardRow() {
  const response = await request("/dashboard");
  const start = response.body.indexOf(`href="${FIXTURE_CARD}"`);
  const end = start === -1 ? -1 : response.body.indexOf("</a>", start);
  return { ...response, body: end === -1 ? "" : response.body.slice(start, end) };
}

// Which of the two fixture offers stands higher on /dashboard under one sort: "first" or "second", by where each
// row's link is in the page. Only these two rows are compared, so other offers in the local database do not
// matter. Throws when either row is missing, which fails the step that asked for it: no row is never "in order".
async function fixtureBoardOrder(sort, dir) {
  const response = await request(`/dashboard?sort=${sort}&dir=${dir}`);
  const first = response.body.indexOf(`href="${FIXTURE_CARD}"`);
  const second = response.body.indexOf(`href="/offers/${FIXTURE_OFFER_ID_2}"`);
  if (first === -1 || second === -1) {
    const missing = [first === -1 ? "first" : "", second === -1 ? "second" : ""].filter(Boolean).join(" and ");
    throw new Error(`no board row for the ${missing} fixture offer (${response.status})`);
  }
  return { ...response, higher: first < second ? "first" : "second" };
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["signup page is gone", () => request("/auth/signup"), { status: 404 }],
  ["dev kitchen sink is absent from the build", () => request("/dev/offer-card"), { status: 404 }],
  ["dev forms kitchen sink is absent from the build", () => request("/dev/forms"), { status: 404 }],
  ["dev board kitchen sink is absent from the build", () => request("/dev/board"), { status: 404 }],
  ["dev criteria kitchen sink is absent from the build", () => request("/dev/criteria"), { status: 404 }],
  ["dev errors kitchen sink is absent from the build", () => request("/dev/errors"), { status: 404 }],
  // The error pages under their own addresses: each answers with its own status and carries its marker.
  ["503 page answers 503", () => request("/503"), { status: 503, bodyIncludes: 'data-error-page="503"' }],
  ["500 page answers 500", () => request("/500"), { status: 500, bodyIncludes: 'data-error-page="500"' }],
  [
    "signup route is gone",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 404 },
  ],
  ["supabase auth rejects signup", () => supabaseSignup(), { status: 422, errorCode: "signup_disabled" }],
  ["anon cannot read members", () => supabaseMembers({ signedIn: false }), { status: 200, rows: 0 }],
  ["signed-in member reads members", () => supabaseMembers({ signedIn: true }), { status: 200, minRows: 1 }],
  // Both criteria singletons always hold their one row, so 0 rows here is the denial, not an empty table.
  ["anon cannot read the team limits", () => supabaseRest("team_criteria?select=id"), { status: 200, rows: 0 }],
  [
    "signed-in member reads the team limits",
    () => supabaseRest("team_criteria?select=id", { as: MEMBER }),
    { status: 200, rows: 1 },
  ],
  [
    "anon cannot read the criteria revision",
    () => supabaseRest("criteria_revision?select=id"),
    { status: 200, rows: 0 },
  ],
  [
    "signed-in member reads the criteria revision",
    () => supabaseRest("criteria_revision?select=id", { as: MEMBER }),
    { status: 200, rows: 1 },
  ],
  // The limits are one row the whole team shares, and the local database may hold limits a person set, so they are
  // read before the first attempt to write them and written back by cleanup.
  ["team limits before the run are read", () => readLimitsBefore(), { status: 200, rows: 1 }],
  [
    "anon cannot change the team limits",
    () =>
      supabaseRest("team_criteria?id=eq.true", {
        method: "PATCH",
        prefer: "return=representation",
        body: { city: "smoke: anon" },
      }),
    { status: 200, rows: 0 },
  ],
  // The audit settings are a singleton as well, so 0 rows is the denial there too. They are read before the first
  // attempt to write them and written back by cleanup, as the limits are; that read is also the member's side of
  // the gate.
  ["anon cannot read the audit settings", () => supabaseRest("audit_settings?select=id"), { status: 200, rows: 0 }],
  ["audit settings before the run are read", () => readAuditSettingsBefore(), { status: 200, rows: 1 }],
  [
    "anon cannot change the audit settings",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        supabaseRest(AUDIT_SETTINGS, {
          method: "PATCH",
          prefer: "return=representation",
          body: { effort: "low" },
        }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, locationPrefix: "/auth/signin?error=" },
  ],
  [
    "signin rejects a non-form body",
    () => request("/api/auth/signin", { method: "POST", json: { email, password } }),
    { status: 302, locationPrefix: "/auth/signin?error=" },
  ],
  [
    "offer save redirects anonymous user",
    () => request("/api/offers", { method: "POST", form: { url: "https://www.otodom.pl/pl/oferta/x-ID1" } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "note save redirects anonymous user",
    () => request("/api/notes", { method: "POST", form: { offer_id: randomUUID(), pros: "smoke" } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "limits save redirects anonymous user",
    () => request("/api/criteria", { method: "POST", form: { city: "smoke" } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "requirements save redirects anonymous user",
    () => request("/api/requirements", { method: "POST", form: { body: "smoke" } }),
    { status: 302, location: "/auth/signin" },
  ],
  // The values are ones the route would save, so the redirect is the missing session and not a refused value. The
  // settings row is watched around it: an anonymous save must not reach it.
  [
    "audit settings save redirects anonymous user",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        request("/api/audit-settings", { method: "POST", form: { model: AUDIT_MODELS[1], effort: "low" } }),
      ),
    { status: 302, location: "/auth/signin", snapshot: "same" },
  ],
  // The id is a well-formed one, so the redirect is the missing session and not a refused id. No session is the
  // only case in which the audit route redirects at all.
  [
    "audit run redirects anonymous user",
    () => request("/api/audits", { method: "POST", form: { offer_id: randomUUID() } }),
    { status: 302, location: "/auth/signin" },
  ],
  // A session Auth refuses reads as signed out, on a page and on a form route alike: the 503 page is for an Auth
  // that could not answer, never for one that said no.
  [
    "dashboard redirects a forged session to sign-in",
    () => requestWithForgedSession("/dashboard"),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "offer save redirects a forged session to sign-in",
    () =>
      requestWithForgedSession("/api/offers", {
        method: "POST",
        form: { url: "https://www.otodom.pl/pl/oferta/x-ID1" },
      }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "audit settings save redirects a forged session to sign-in",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        requestWithForgedSession("/api/audit-settings", {
          method: "POST",
          form: { model: AUDIT_MODELS[1], effort: "low" },
        }),
      ),
    { status: 302, location: "/auth/signin", snapshot: "same" },
  ],
  [
    "audit run redirects a forged session to sign-in",
    () => requestWithForgedSession("/api/audits", { method: "POST", form: { offer_id: randomUUID() } }),
    { status: 302, location: "/auth/signin" },
  ],
  ["criteria page redirects anonymous user", () => request("/criteria"), { status: 302, location: "/auth/signin" }],
  [
    "offer card redirects anonymous user",
    () => request(`/offers/${randomUUID()}`),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["home redirects signed-in user", () => request("/"), { status: 302, location: "/dashboard" }],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["board reads offers without error", () => request("/dashboard"), { status: 200, bodyIncludes: BOARD_OK }],
  [
    "board sorts by price ascending",
    () => request("/dashboard?sort=price&dir=asc"),
    { status: 200, bodyIncludes: BOARD_OK },
  ],
  [
    "board sorts by area descending",
    () => request("/dashboard?sort=area&dir=desc"),
    { status: 200, bodyIncludes: BOARD_OK },
  ],
  [
    "board ignores an unknown sort",
    () => request("/dashboard?sort=bogus&dir=sideways"),
    { status: 200, bodyIncludes: BOARD_OK },
  ],
  ["offer card 404s on a non-uuid id", () => request("/offers/not-a-uuid"), { status: 404 }],
  ["offer card 404s on an unknown uuid", () => request(`/offers/${randomUUID()}`), { status: 404 }],
  [
    "offer save rejects a non-form body",
    () => request("/api/offers", { method: "POST", json: { url: "https://www.otodom.pl/pl/oferta/x-ID1" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "offer save rejects empty url",
    () => request("/api/offers", { method: "POST", form: { url: "" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "offer save rejects foreign host",
    () => request("/api/offers", { method: "POST", form: { url: "https://www.olx.pl/d/oferta/xyz" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "offer save rejects otodom non-offer url",
    () =>
      request("/api/offers", {
        method: "POST",
        form: { url: "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa" },
      }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  // The audit route, as far as it goes without an offer: both answers are decided before a provider key is looked
  // for, and neither request names an offer that exists - the fixture offers are not even created yet.
  [
    "audit run refuses an id that is not a uuid",
    () => requestAuditOfMissingOffer("not-a-uuid"),
    { status: 200, auditEnded: "invalid_offer" },
  ],
  [
    "audit run refuses an offer that does not exist",
    () => requestAuditOfMissingOffer(randomUUID()),
    { status: 200, auditEnded: "offer_not_found" },
  ],
  ["smoke fixture offer is created", () => createFixtureOffer(FIXTURE_OFFER_ID), { status: 201, rows: 1 }],
  ["second smoke fixture offer is created", () => createFixtureOffer(FIXTURE_OFFER_ID_2), { status: 201, rows: 1 }],
  [
    "note save rejects a non-form body",
    () => request("/api/notes", { method: "POST", json: { offer_id: FIXTURE_OFFER_ID, pros: "smoke" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "note save rejects a non-uuid offer",
    () => request("/api/notes", { method: "POST", form: { offer_id: "not-a-uuid", pros: "smoke" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "note save rejects an unknown offer",
    () => request("/api/notes", { method: "POST", form: { offer_id: randomUUID(), pros: "smoke" } }),
    { status: 302, locationPrefix: "/dashboard?error=" },
  ],
  [
    "note save rejects a blank note",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { offer_id: FIXTURE_OFFER_ID, pros: "", cons: "", observations: "" },
      }),
    { status: 302, locationPrefix: `${FIXTURE_CARD}?error=` },
  ],
  [
    "note save stores the note",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { offer_id: FIXTURE_OFFER_ID, pros: NOTE_FIRST, cons: "", observations: "" },
      }),
    { status: 302, location: `${FIXTURE_CARD}#notatki` },
  ],
  [
    "note save edits the same note",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { offer_id: FIXTURE_OFFER_ID, pros: NOTE_EDITED, cons: "", observations: "smoke" },
      }),
    { status: 302, location: `${FIXTURE_CARD}#notatki` },
  ],
  [
    "offer card shows the saved note",
    () => request(FIXTURE_CARD),
    { status: 200, bodyIncludes: [NOTE_EDITED, NOTES_OK] },
  ],
  // Both members' notes side by side: the second member's on the same offer, and both members' on the second offer.
  [
    "another member writes their own note on the fixture offer",
    () => createNote(OTHER_MEMBER, FIXTURE_OFFER_ID),
    { status: 201, rows: 1 },
  ],
  [
    "member writes a note on the second fixture offer",
    () => createNote(MEMBER, FIXTURE_OFFER_ID_2),
    { status: 201, rows: 1 },
  ],
  [
    "another member writes a note on the second fixture offer",
    () => createNote(OTHER_MEMBER, FIXTURE_OFFER_ID_2),
    { status: 201, rows: 1 },
  ],
  // Control: the row comparison must report a change when there is one, or a wrapper reading the wrong row would
  // pass every "same" step. The second save changes no text, so only `updated_at` moves.
  [
    "control: an edited note is reported as changed",
    () =>
      withSnapshot([observedNote(MEMBER)], () =>
        noteRest(MEMBER, {
          as: MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { cons: NOTE_CONTROL },
        }),
      ),
    { status: 200, rows: 1, snapshot: "changed" },
  ],
  [
    "control: a note saved again with the same text is reported as changed",
    () =>
      withSnapshot([observedNote(MEMBER)], () =>
        noteRest(MEMBER, {
          as: MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { cons: NOTE_CONTROL },
        }),
      ),
    { status: 200, rows: 1, snapshot: "changed" },
  ],
  // RLS from every side, only now that a note exists: before it, `[]` would prove nothing.
  ["member keeps one note per offer", () => noteRest(MEMBER, { as: MEMBER, select: "id" }), { status: 200, rows: 1 }],
  ["anon cannot read notes", () => supabaseRest(`${FIXTURE_NOTES}&select=id`), { status: 200, rows: 0 }],
  [
    "another member reads the note",
    () => noteRest(MEMBER, { as: OTHER_MEMBER, select: "id" }),
    { status: 200, rows: 1 },
  ],
  // Each attempt on the first member's note runs between two reads of that whole row: the status and the row
  // count say the write was turned away, the comparison says the note is the same afterwards.
  [
    "another member cannot edit the note",
    () =>
      withSnapshot([observedNote(MEMBER)], () =>
        noteRest(MEMBER, {
          as: OTHER_MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { pros: "smoke: nadpisane przez innego członka" },
        }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  [
    "another member cannot delete the note",
    () =>
      withSnapshot([observedNote(MEMBER)], () =>
        noteRest(MEMBER, { as: OTHER_MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  // Without `Prefer` a denied delete answers 204 with no body, exactly as a successful one does: the status proves
  // nothing here and the unchanged row is the only evidence. The denial runs the other way round - the first member
  // against the second member's note - so this step, the one above and the delete by offer below each have a note
  // of their own to lose, and each turns red by itself if the delete policy lets another member through.
  [
    "member's delete of another member's note without Prefer answers 204 and leaves the note",
    () => withSnapshot([observedNote(OTHER_MEMBER)], () => noteRest(OTHER_MEMBER, { as: MEMBER, method: "DELETE" })),
    { status: 204, snapshot: "same" },
  ],
  [
    "another member cannot write a note as its author",
    () => withSnapshot([observedNote(MEMBER)], () => forgeNote({ upsert: false })),
    { status: 403, errorCode: "42501", snapshot: "same" },
  ],
  [
    "another member cannot upsert over the note as its author",
    () => withSnapshot([observedNote(MEMBER)], () => forgeNote({ upsert: true })),
    { status: 403, errorCode: "42501", snapshot: "same" },
  ],
  // No author in the body: nulls never collide with the one-note-per-member key, so were the insert admitted, the
  // new row would show among the offers' notes instead of hiding behind a unique violation.
  [
    "anon cannot write a note",
    () =>
      withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () =>
        supabaseRest("offer_notes", { method: "POST", body: { offer_id: FIXTURE_OFFER_ID, pros: "smoke: anon" } }),
      ),
    { status: 401, errorCode: "42501", snapshot: "same" },
  ],
  // A write that succeeds, next to another member's row: the filter names the offer and no author, so it reaches
  // both members' notes, and the policy must let through only the writer's own.
  [
    "another member's edit of every note on the offer changes only their own",
    () =>
      withSnapshot([observedNote(MEMBER)], () =>
        supabaseRest(FIXTURE_NOTES, {
          as: OTHER_MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { observations: "smoke: edycja bez filtra autora" },
        }),
      ),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "another member's delete of every note on the second offer removes only their own",
    () =>
      withSnapshot([observedNote(MEMBER, FIXTURE_OFFER_ID_2)], () =>
        supabaseRest(FIXTURE_NOTES_2, { as: OTHER_MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  // The author's patch is filtered by the offer alone too, so the second member's note there is watched.
  [
    "author's patch of the note's identity is accepted",
    () => withSnapshot([observedNote(OTHER_MEMBER)], () => patchNoteIdentity()),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "note keeps its offer, author, id and database-set dates",
    () => withSnapshot([observedNote(OTHER_MEMBER)], () => noteIdentityAfterPatch()),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  // An offer write against the notes (FR-009) and against the offer's author. The writer is the member who did
  // not save the offer; the notes left by now are both members' on the first offer and the first member's on the
  // second.
  [
    "another member's rewrite of the listing data leaves every note as it was",
    () => withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () => rewriteListingAsOther()),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "fixture offer keeps its author after another member claims it",
    () => offerStillByMember(),
    { status: 200, rows: 1 },
  ],
  [
    "another member's patch clearing the offer's author is accepted",
    () => withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () => patchOfferAsOther({ created_by: null })),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "fixture offer keeps its author after another member clears it",
    () => offerStillByMember(),
    { status: 200, rows: 1 },
  ],
  // Team criteria. The limits as they stood before the run were read above, before the first write attempt.
  [
    "member cannot insert a second limits row",
    () => supabaseRest("team_criteria", { as: MEMBER, method: "POST", body: { id: true } }),
    { status: 403, errorCode: "42501" },
  ],
  [
    "member cannot delete the limits row",
    () => supabaseRest("team_criteria?id=eq.true", { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 0 },
  ],
  [
    "member cannot write the criteria revision",
    () =>
      supabaseRest("criteria_revision?id=eq.true", {
        as: MEMBER,
        method: "PATCH",
        prefer: "return=representation",
        body: { revision: 0 },
      }),
    { status: 200, rows: 0 },
  ],
  [
    "member cannot store a limit the form would refuse",
    () =>
      supabaseRest("team_criteria?id=eq.true", {
        as: MEMBER,
        method: "PATCH",
        prefer: "return=representation",
        body: { price_min: 850000.5 },
      }),
    { status: 400, errorCode: "23514" },
  ],
  [
    "limits save rejects a reversed price range",
    () =>
      withRevision(() =>
        request("/api/criteria", {
          method: "POST",
          form: { city: SMOKE_CITY, price_min: "900000", price_max: "800000", area_min: "" },
        }),
      ),
    { status: 302, locationPrefix: "/criteria?error=", locationIncludes: "&form=limits#limity", revisionDelta: 0 },
  ],
  [
    "limits save stores the limits and bumps the revision",
    () =>
      withRevision(() =>
        request("/api/criteria", {
          method: "POST",
          form: { intent: "save", city: SMOKE_CITY, price_min: "", price_max: String(SMOKE_PRICE_MAX), area_min: "" },
        }),
      ),
    { status: 302, location: "/criteria#limity", revisionDelta: 1 },
  ],
  [
    "saving the same limits again keeps the revision",
    () =>
      withRevision(() =>
        request("/api/criteria", {
          method: "POST",
          form: { city: SMOKE_CITY, price_min: "", price_max: String(SMOKE_PRICE_MAX), area_min: "" },
        }),
      ),
    { status: 302, location: "/criteria#limity", revisionDelta: 0 },
  ],
  [
    "member's patch of the limits' signature is accepted",
    () => withRevision(() => patchLimitsSignature()),
    { status: 200, rows: 1, revisionDelta: 0 },
  ],
  ["limits keep their signature, date and id", () => limitsSignatureAfterPatch(), { status: 200, rows: 1 }],
  [
    "requirements save rejects blank requirements",
    () => withRevision(() => request("/api/requirements", { method: "POST", form: { body: "   " } })),
    {
      status: 302,
      locationPrefix: "/criteria?error=",
      locationIncludes: "&form=requirements#wymagania",
      revisionDelta: 0,
    },
  ],
  [
    "requirements save stores them and bumps the revision",
    () =>
      withRevision(() =>
        request("/api/requirements", { method: "POST", form: { intent: "save", body: REQUIREMENTS_FIRST } }),
      ),
    { status: 302, location: "/criteria#wymagania", revisionDelta: 1 },
  ],
  // The control for requirements, as the two for notes: the member's own row is observed around their own edit, so
  // a comparison that stopped seeing a change in public.member_requirements fails the run here. The text has to
  // change - saving the same requirements again moves no date.
  [
    "control: requirements save edits them, bumps the revision and is reported as changed",
    () =>
      withRevision(() =>
        withSnapshot([observedRequirements(MEMBER)], () =>
          request("/api/requirements", { method: "POST", form: { body: REQUIREMENTS_EDITED } }),
        ),
      ),
    { status: 302, location: "/criteria#wymagania", snapshot: "changed", revisionDelta: 1 },
  ],
  ["another member saves their own requirements", () => saveOtherRequirements(), { status: [201, 200], rows: 1 }],
  [
    "criteria page shows the limits and both members' requirements",
    () => request("/criteria"),
    { status: 200, bodyIncludes: [CRITERIA_OK, SMOKE_CITY, REQUIREMENTS_EDITED, REQUIREMENTS_OTHER] },
  ],
  // RLS from every side, only now that the first member's requirements exist: before them, `[]` would prove nothing.
  ["member keeps one set of requirements", () => requirementsRest(MEMBER, { as: MEMBER }), { status: 200, rows: 1 }],
  [
    "anon cannot read requirements",
    () => supabaseRest("member_requirements?select=author_id"),
    { status: 200, rows: 0 },
  ],
  [
    "another member reads the requirements",
    () => requirementsRest(MEMBER, { as: OTHER_MEMBER }),
    { status: 200, rows: 1, bodyIncludes: REQUIREMENTS_EDITED },
  ],
  // Each attempt on the first member's requirements runs between two reads of that whole row, as for notes.
  [
    "another member cannot edit the requirements",
    () =>
      withSnapshot([observedRequirements(MEMBER)], () =>
        requirementsRest(MEMBER, {
          as: OTHER_MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { body: "smoke: nadpisane przez innego członka" },
        }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  [
    "another member cannot write requirements as their author",
    () => withSnapshot([observedRequirements(MEMBER)], () => forgeRequirements({ upsert: false })),
    { status: 403, errorCode: "42501", snapshot: "same" },
  ],
  [
    "another member cannot upsert over the requirements as their author",
    () => withSnapshot([observedRequirements(MEMBER)], () => forgeRequirements({ upsert: true })),
    { status: 403, errorCode: "42501", snapshot: "same" },
  ],
  // A write that succeeds, next to the other member's row: the filter names both authors, and the policy must let
  // through only the writer's own. The first member's text really changes, so the revision moves by one - by two
  // if the second member's were rewritten as well.
  [
    "member's edit of both members' requirements changes only their own",
    () =>
      withRevision(() =>
        withSnapshot([observedRequirements(OTHER_MEMBER)], () =>
          writeBothRequirements(MEMBER, { method: "PATCH", body: { body: REQUIREMENTS_WIDE } }),
        ),
      ),
    { status: 200, rows: 1, snapshot: "same", revisionDelta: 1 },
  ],
  [
    "another member's delete of both members' requirements removes only their own",
    () => withSnapshot([observedRequirements(MEMBER)], () => writeBothRequirements(OTHER_MEMBER, { method: "DELETE" })),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  // The second member's requirements are back, as a new row (201), for the steps below to observe.
  ["another member saves their own requirements again", () => saveOtherRequirements(), { status: 201, rows: 1 }],
  // The denied delete runs the other way round - the first member against the second member's requirements - and
  // after the re-save. A member holds one row, so this step and the delete of both above each need a row of their
  // own to lose: were the delete policy to let another member through, that delete takes the first member's row
  // and this one the second member's, and each turns red by itself.
  [
    "member cannot delete another member's requirements",
    () =>
      withSnapshot([observedRequirements(OTHER_MEMBER)], () =>
        requirementsRest(OTHER_MEMBER, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  // From here on the second member's requirements are watched around everything the first member writes.
  [
    "author's patch of the requirements' identity is accepted",
    () => withRevision(() => withSnapshot([observedRequirements(OTHER_MEMBER)], () => patchRequirementsIdentity())),
    { status: 200, rows: 1, revisionDelta: 0, snapshot: "same" },
  ],
  [
    "requirements keep their author and database-set dates",
    () => requirementsIdentityAfterPatch(),
    { status: 200, rows: 1 },
  ],
  // The limit mark: a stated PLN price above the saved ceiling. One more offer write the notes must not feel.
  [
    "fixture offer gets a price above the limit",
    () =>
      withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () =>
        supabaseRest(FIXTURE_OFFER, {
          as: MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { price: SMOKE_PRICE_MAX + 1, price_currency: "PLN" },
        }),
      ),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  ["board reads the team limits", () => request("/dashboard"), { status: 200, bodyIncludes: [BOARD_OK, LIMITS_OK] }],
  [
    "board marks the fixture offer above the price limit",
    () => fixtureBoardRow(),
    { status: 200, bodyIncludes: 'data-limit-breach="price_above"' },
  ],
  // Unknown values last (prd.md, Guardrails): an offer that does not state its price or its area is never the
  // cheapest or the largest. The first fixture offer states a price and no area; the write below gives the second
  // an area, and it has no price. So the first stands higher by price and the second by area, each in both
  // directions - Postgres puts nulls first for `desc`, which is where the query's `nullsFirst: false` decides.
  [
    "second fixture offer gets an area",
    () =>
      withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () =>
        supabaseRest(FIXTURE_OFFER_2, {
          as: MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { area_m2: 50 },
        }),
      ),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "board puts the offer without a price last when sorted by price ascending",
    () => fixtureBoardOrder("price", "asc"),
    { status: 200, bodyIncludes: BOARD_OK, higher: "first" },
  ],
  [
    "board puts the offer without a price last when sorted by price descending",
    () => fixtureBoardOrder("price", "desc"),
    { status: 200, bodyIncludes: BOARD_OK, higher: "first" },
  ],
  [
    "board puts the offer without an area last when sorted by area ascending",
    () => fixtureBoardOrder("area", "asc"),
    { status: 200, bodyIncludes: BOARD_OK, higher: "second" },
  ],
  [
    "board puts the offer without an area last when sorted by area descending",
    () => fixtureBoardOrder("area", "desc"),
    { status: 200, bodyIncludes: BOARD_OK, higher: "second" },
  ],
  [
    "requirements delete removes them and bumps the revision",
    () =>
      withRevision(() =>
        withSnapshot([observedRequirements(OTHER_MEMBER)], () =>
          request("/api/requirements", { method: "POST", form: { intent: "delete" } }),
        ),
      ),
    { status: 302, location: "/criteria#wymagania", revisionDelta: 1, snapshot: "same" },
  ],
  ["member's requirements are gone", () => requirementsRest(MEMBER, { as: MEMBER }), { status: 200, rows: 0 }],
  [
    "limits clear removes every limit and bumps the revision",
    () =>
      withRevision(() =>
        withSnapshot([observedRequirements(OTHER_MEMBER)], () =>
          request("/api/criteria", { method: "POST", form: { intent: "clear" } }),
        ),
      ),
    { status: 302, location: "/criteria#limity", revisionDelta: 1, snapshot: "same" },
  ],
  [
    "cleared limits are all empty",
    () =>
      supabaseRest("team_criteria?city=is.null&price_min=is.null&price_max=is.null&area_min=is.null&select=id", {
        as: MEMBER,
      }),
    { status: 200, rows: 1 },
  ],
  // AI audit, straight against Supabase. The settings first: the row is watched whole around every attempt on it,
  // signature and date included. The insert carries a model and an effort the table would take, so the refusal is
  // the missing insert policy and not a check.
  [
    "member cannot insert a second audit settings row",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        supabaseRest("audit_settings", {
          as: MEMBER,
          method: "POST",
          body: { id: true, model: AUDIT_MODELS[0], effort: "medium" },
        }),
      ),
    { status: 403, errorCode: "42501", snapshot: "same" },
  ],
  [
    "member cannot delete the audit settings row",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        supabaseRest(AUDIT_SETTINGS, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  // The control for the settings, as for notes and requirements: a real change must be reported as one, or the
  // "same" steps around this one would pass on a comparison that sees nothing. It also puts a signature on the row
  // for the next two steps: the first member's, set by the trigger.
  [
    "control: a changed audit model is reported as changed",
    () => withSnapshot([observedAuditSettings()], () => changeAuditModel()),
    { status: 200, rows: 1, snapshot: "changed" },
  ],
  [
    "audit settings are signed by the member who changed them",
    () => auditSettingsSignedByMember(),
    { status: 200, rows: 1 },
  ],
  [
    "member's patch of the audit settings' signature, date and id is accepted and changes nothing",
    () => withSnapshot([observedAuditSettings()], () => patchAuditSettingsSignature()),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  // The settings through the app's own route, with the member's session cookie. A refusal lands back on /criteria
  // naming the settings form, and the row is the same afterwards.
  [
    "audit settings save rejects a non-form body",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        request("/api/audit-settings", { method: "POST", json: { model: AUDIT_MODELS[0], effort: "medium" } }),
      ),
    { status: 302, locationPrefix: "/criteria?error=", locationIncludes: "&form=audit#audyt", snapshot: "same" },
  ],
  [
    "audit settings save rejects a model outside the list",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        request("/api/audit-settings", { method: "POST", form: { model: "smoke-model", effort: "medium" } }),
      ),
    { status: 302, locationPrefix: "/criteria?error=", locationIncludes: "&form=audit#audyt", snapshot: "same" },
  ],
  // `max` is an effort the provider takes and the team's list leaves out.
  [
    "audit settings save rejects an effort outside the list",
    () =>
      withSnapshot([observedAuditSettings()], () =>
        request("/api/audit-settings", { method: "POST", form: { model: AUDIT_MODELS[0], effort: "max" } }),
      ),
    { status: 302, locationPrefix: "/criteria?error=", locationIncludes: "&form=audit#audyt", snapshot: "same" },
  ],
  // The control for the route, as the Data API one above is for the table: the form's save must be reported as a
  // change, or the "same" steps around it would pass on a route that writes nothing.
  [
    "control: audit settings save stores the chosen model and effort and is reported as changed",
    () => withSnapshot([observedAuditSettings()], () => saveAuditSettingsThroughForm()),
    { status: 302, location: "/criteria#audyt", snapshot: "changed" },
  ],
  [
    "audit settings hold what the form saved, signed by the member",
    () => auditSettingsAsSavedThroughForm(),
    { status: 200, rows: 1 },
  ],
  [
    "criteria page shows the saved audit settings",
    () => criteriaAfterAuditSettingsSave(),
    { status: 200, bodyIncludes: [CRITERIA_OK, AUDIT_SETTINGS_OK] },
  ],
  // The trigger keeps the signature and the date when nothing changes, so re-saving the form is not a change.
  [
    "saving the same audit settings again keeps the row, its signature and date",
    () => withSnapshot([observedAuditSettings()], () => saveAuditSettingsThroughForm()),
    { status: 302, location: "/criteria#audyt", snapshot: "same" },
  ],
  // Audit attempts. The anonymous insert aims at the first fixture offer, which has no audit row: were it admitted,
  // no unique violation would hide it, and the step after the member's insert would find it.
  [
    "anon cannot start an audit attempt",
    () => supabaseRest("offer_audits", { method: "POST", body: { offer_id: FIXTURE_OFFER_ID, run_state: "running" } }),
    { status: 401, errorCode: "42501" },
  ],
  ["member starts an audit attempt on the second fixture offer", () => startAuditAttempt(), { status: 201, rows: 1 }],
  [
    "audit attempt is signed and dated by the database and holds no result",
    () => auditAttemptAsStored(),
    { status: 200, rows: 1 },
  ],
  // The member has just read the second offer's attempt, so 0 rows here is an offer without one, not a denial.
  [
    "first fixture offer has no audit attempt",
    () => supabaseRest(`${FIXTURE_AUDIT}&select=offer_id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  // The cards, read and never run. The first offer has no row, so its card says "none" with a provider key and
  // without one. The second offer's attempt started a moment ago, far inside the 175 seconds after which it would
  // read as interrupted: its card says "running", which is what proves the marker follows the offer's own row.
  [
    "offer card of an offer nobody audited says so",
    () => request(FIXTURE_CARD),
    { status: 200, bodyIncludes: AUDIT_NONE },
  ],
  [
    "control: offer card of the second fixture offer shows its running attempt",
    () => request(FIXTURE_CARD_2),
    { status: 200, bodyIncludes: AUDIT_RUNNING },
  ],
  // The board reads the audits beside the offers. An attempt is not a result: the row of the first fixture offer
  // reads „Nie audytowano", and the marker says that sentence comes from a read that succeeded.
  ["board reads the audits without error", () => request("/dashboard"), { status: 200, bodyIncludes: AUDITS_OK }],
  [
    "board row of an offer nobody audited says so",
    () => fixtureBoardRow(),
    { status: 200, bodyIncludes: "Nie audytowano" },
  ],
  // RLS from the other sides, only now that an attempt exists: before it, `[]` would prove nothing.
  [
    "anon cannot read audit attempts",
    () => supabaseRest(`${FIXTURE_AUDIT_2}&select=offer_id`),
    { status: 200, rows: 0 },
  ],
  [
    "another member reads the audit attempt",
    () => supabaseRest(`${FIXTURE_AUDIT_2}&select=offer_id`, { as: OTHER_MEMBER }),
    { status: 200, rows: 1 },
  ],
  // The lock: the attempt started a moment ago, far inside the 175 seconds a running one is protected for, so the
  // update policy lets the second member's write through and the trigger refuses it with the table's own SQLSTATE.
  [
    "another member cannot take over the running audit attempt",
    () =>
      withSnapshot([observedAudit()], () =>
        supabaseRest(FIXTURE_AUDIT_2, {
          as: OTHER_MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { run_state: "running" },
        }),
      ),
    { status: 400, errorCode: "VP001", snapshot: "same" },
  ],
  // Nobody has a delete policy on an audit, its starter included: it goes only with its offer (cleanup, below).
  [
    "member cannot delete their own audit attempt",
    () =>
      withSnapshot([observedAudit()], () =>
        supabaseRest(FIXTURE_AUDIT_2, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 0, snapshot: "same" },
  ],
  // The control for the attempt's row: failing it is a move the trigger allows, and it must be reported as a change.
  [
    "control: a failed audit attempt is reported as changed",
    () =>
      withSnapshot([observedAudit()], () =>
        supabaseRest(FIXTURE_AUDIT_2, {
          as: MEMBER,
          method: "PATCH",
          prefer: "return=representation",
          body: { run_state: "failed", run_failure: "smoke" },
        }),
      ),
    { status: 200, rows: 1, snapshot: "changed" },
  ],
  // The same card after the control step failed its attempt: the marker moved with the row, and the first offer's
  // card still says "none".
  [
    "control: offer card of the second fixture offer shows its failed attempt",
    () => request(FIXTURE_CARD_2),
    { status: 200, bodyIncludes: AUDIT_FAILED },
  ],
  [
    "offer card of an offer nobody audited still says so",
    () => request(FIXTURE_CARD),
    { status: 200, bodyIncludes: AUDIT_NONE },
  ],
  // Cleanup: runs even when a step above failed, because every step runs. The limits are written back even when
  // the second member's requirements are no longer there to observe.
  [
    "team limits are restored to their state before the run",
    () => withSnapshot([observedRequirements(OTHER_MEMBER)], () => restoreLimits(), { runUnobserved: true }),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  ["audit settings are restored to their state before the run", () => restoreAuditSettings(), { status: 200, rows: 1 }],
  // Both deletes count their rows: a bare 204 would pass whether or not a row was there. The route deleted the
  // first member's requirements, so none are left; the second member's must have lasted until now.
  [
    "member's smoke requirements are already gone at cleanup",
    () => requirementsRest(MEMBER, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 0 },
  ],
  [
    "other member's smoke requirements are deleted",
    () => requirementsRest(OTHER_MEMBER, { as: OTHER_MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 1 },
  ],
  [
    "no smoke requirements remain",
    async () => supabaseRest(`${await bothRequirementsPath()}&select=author_id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  // The cascade (FR-015), both ways: deleting the offer takes every member's notes on it, the first member's
  // among them although the second member has no delete policy on that note, and nothing from the other offer.
  ["fixture offer holds both members' notes before it is deleted", () => bothMembersNotes(), { status: 200, rows: 2 }],
  [
    "another member deletes the fixture offer and the second offer's notes stay as they were",
    () =>
      withSnapshot([observedNotes(FIXTURE_NOTES_2)], () =>
        supabaseRest(FIXTURE_OFFER, { as: OTHER_MEMBER, method: "DELETE", prefer: "return=representation" }),
      ),
    { status: 200, rows: 1, snapshot: "same" },
  ],
  [
    "both members' notes are gone with the offer",
    () => supabaseRest(`${FIXTURE_NOTES}&select=id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  // The same cascade for the audit, which no member can delete by itself: it is there until its offer goes.
  [
    "second fixture offer holds its audit attempt before it is deleted",
    () => supabaseRest(`${FIXTURE_AUDIT_2}&select=offer_id`, { as: MEMBER }),
    { status: 200, rows: 1 },
  ],
  [
    "second fixture offer is deleted",
    () => supabaseRest(FIXTURE_OFFER_2, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 1 },
  ],
  [
    "second fixture offer's notes are gone with it",
    () => supabaseRest(`${FIXTURE_NOTES_2}&select=id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  [
    "second fixture offer's audit attempt is gone with it",
    () => supabaseRest(`${FIXTURE_AUDIT_2}&select=offer_id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  // Both fixture offers are gone by now, so this finds nothing. Were a delete above to fail or never run, this
  // takes what is left - and fails on the count, on top of the step that failed.
  [
    "cleanup finds no smoke fixture offer left to delete",
    () => supabaseRest(FIXTURE_OFFERS, { as: MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 0 },
  ],
  [
    "no smoke fixture offer remains",
    () => supabaseRest(`${FIXTURE_OFFERS}&select=id`, { as: MEMBER }),
    { status: 200, rows: 0 },
  ],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
];

function expectedRows(expected) {
  if (expected.rows !== undefined) return `${expected.rows} row(s)`;
  if (expected.minRows !== undefined) return `at least ${expected.minRows} row(s)`;
  return "";
}

// How far a step moved the criteria revision, for the report line; empty when the step does not measure it.
function revisionMoved({ revisionDelta }) {
  return revisionDelta === undefined ? "" : `, revision +${revisionDelta}`;
}

// Whether the rows a step observed stayed the same, for the report line; empty when the step does not compare any.
function snapshotResult({ snapshot, snapshotRows }) {
  if (snapshot === undefined) return "";
  return `, ${snapshotRows === undefined ? "observed" : `${snapshotRows} observed`} row(s) ${snapshot}`;
}

// Which fixture offer stood higher on the board, for the report line; empty when the step does not compare rows.
function boardOrder({ higher }) {
  return higher === undefined ? "" : `, ${higher} fixture offer higher`;
}

// How an audit request ended, for the report line; empty when the step sends none.
function auditEnding({ auditEnded }) {
  return auditEnded === undefined ? "" : `, audit ended: ${auditEnded}`;
}

function includesAll(body, expected) {
  return [expected].flat().every((text) => (body ?? "").includes(text));
}

let failed = 0;
for (const [name, run, expected] of steps) {
  // A thrown request is a failed step, not the end of the run: the fixture offer's cleanup step must still run.
  // `run` is called inside the chain, so a step that throws before its first await, or returns a plain value, is caught too.
  const actual = await Promise.resolve()
    .then(run)
    .catch((error) => ({ status: 0, location: "", error: error.message }));
  const ok =
    !actual.error &&
    [expected.status].flat().includes(actual.status) &&
    (expected.location === undefined || actual.location === expected.location) &&
    (expected.locationPrefix === undefined || actual.location.startsWith(expected.locationPrefix)) &&
    (expected.locationIncludes === undefined || actual.location.includes(expected.locationIncludes)) &&
    (expected.errorCode === undefined || actual.errorCode === expected.errorCode) &&
    (expected.bodyIncludes === undefined || includesAll(actual.body, expected.bodyIncludes)) &&
    (expected.rows === undefined || actual.rows === expected.rows) &&
    (expected.minRows === undefined || (actual.rows !== undefined && actual.rows >= expected.minRows)) &&
    (expected.revisionDelta === undefined || actual.revisionDelta === expected.revisionDelta) &&
    (expected.snapshot === undefined || actual.snapshot === expected.snapshot) &&
    (expected.higher === undefined || actual.higher === expected.higher) &&
    (expected.auditEnded === undefined || actual.auditEnded === expected.auditEnded);
  const rows = actual.rows === undefined ? undefined : `${actual.rows} row(s)`;
  const detail =
    actual.error ??
    `${actual.status} ${actual.errorCode ?? rows ?? actual.location}${revisionMoved(actual)}${snapshotResult(actual)}${boardOrder(actual)}${auditEnding(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${detail}`);
  if (!ok) {
    failed++;
    console.log(
      `      expected ${[expected.status].flat().join(" or ")} ${expected.errorCode ?? expected.location ?? expected.locationPrefix ?? expected.bodyIncludes ?? expectedRows(expected)}${expected.locationIncludes === undefined ? "" : ` with ${expected.locationIncludes}`}${revisionMoved(expected)}${snapshotResult(expected)}${boardOrder(expected)}${auditEnding(expected)}`,
    );
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
