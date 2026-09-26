// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// that registration is closed both in the app and in Supabase Auth (FR-001), and that /api/offers refuses
// anonymous callers and URLs that are not otodom.pl offers before any request reaches otodom.pl.
// Signed in, it checks that the offer board on /dashboard reads offers for the default, price, area and an unknown
// sort: each must answer 200 with data-board-state="ok" in the body, because a broken board query also renders
// with 200 (as data-board-state="error") and only the marker tells it apart from an empty board.
// Straight against Supabase, it checks that public.members is gated by row-level security in both directions: the
// publishable key alone reads no rows, a signed-in member reads at least one. RLS denial answers 200 with an empty
// array, so only the row count tells a blocked read from a working one.
// Member notes (FR-012, FR-013): it creates ONE fixture offer as the first seeded member straight in public.offers
// (never through otodom.pl), then checks that /api/notes turns away anonymous users, non-form bodies, unknown offers
// and a blank note, saves and edits the member's note, and that the offer card shows it with
// data-notes-state="ok". Against Supabase it checks public.offer_notes from every side once that note exists: one
// note per member per offer, the publishable key alone reads none, a second seeded member (SMOKE_EMAIL_2) reads it
// but cannot edit or delete it (200 with no rows) nor write a note in the first member's name (403, 42501), and
// the note is unchanged afterwards. Deleting the fixture offer takes its notes with it, and is the last notes step,
// so a failed step in between still leaves nothing behind. Because it writes and deletes an offer, it never runs
// against production.
// It also checks that the dev-only kitchen sinks /dev/offer-card, /dev/forms and /dev/board answer 404: in CI this runs
// against the production preview, where the pages must not exist (on `npm run dev` those steps fail by design).
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 npm run smoke

import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
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
// The one offer this run creates (and deletes) to hang notes on; its id is chosen here so every step can name it.
const FIXTURE_OFFER_ID = randomUUID();
const FIXTURE_CARD = `/offers/${FIXTURE_OFFER_ID}`;
const FIXTURE_NOTES = `offer_notes?offer_id=eq.${FIXTURE_OFFER_ID}`;
// The saved note's text, first as written and then as edited: the card must show the edited one.
const NOTE_FIRST = `smoke-note-${FIXTURE_OFFER_ID}-first`;
const NOTE_EDITED = `smoke-note-${FIXTURE_OFFER_ID}-edited`;

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

async function request(path, { method = "GET", form, json } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
  });
  storeCookies(response);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    body: await response.text(),
  };
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

// Creates the fixture offer as the first member, in the shape /api/offers would save — but with nothing fetched.
async function createFixtureOffer() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest("offers", {
    as: MEMBER,
    method: "POST",
    prefer: "return=representation",
    body: {
      id: FIXTURE_OFFER_ID,
      created_by: member.userId,
      otodom_id: Math.floor(Math.random() * 2 ** 48),
      source_url: `https://example.com/smoke/${FIXTURE_OFFER_ID}`,
      title: "Smoke: oferta testowa",
      description: "Oferta utworzona przez scripts/smoke.mjs i usuwana na końcu przebiegu.",
      raw: {},
    },
  });
}

// The second member tries to insert a note signed with the first member's uid.
async function writeNoteAsAnotherAuthor() {
  const member = await memberId(MEMBER);
  if (member.error) return { status: 0, location: "", error: member.error };
  return supabaseRest("offer_notes", {
    as: OTHER_MEMBER,
    method: "POST",
    body: { offer_id: FIXTURE_OFFER_ID, author_id: member.userId, pros: "smoke: podszywanie się" },
  });
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["signup page is gone", () => request("/auth/signup"), { status: 404 }],
  ["dev kitchen sink is absent from the build", () => request("/dev/offer-card"), { status: 404 }],
  ["dev forms kitchen sink is absent from the build", () => request("/dev/forms"), { status: 404 }],
  ["dev board kitchen sink is absent from the build", () => request("/dev/board"), { status: 404 }],
  [
    "signup route is gone",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 404 },
  ],
  ["supabase auth rejects signup", () => supabaseSignup(), { status: 422, errorCode: "signup_disabled" }],
  ["anon cannot read members", () => supabaseMembers({ signedIn: false }), { status: 200, rows: 0 }],
  ["signed-in member reads members", () => supabaseMembers({ signedIn: true }), { status: 200, minRows: 1 }],
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
  ["smoke fixture offer is created", () => createFixtureOffer(), { status: 201, rows: 1 }],
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
  // RLS from every side, only now that a note exists: before it, `[]` would prove nothing.
  [
    "member keeps one note per offer",
    () => supabaseRest(`${FIXTURE_NOTES}&select=id`, { as: MEMBER }),
    { status: 200, rows: 1 },
  ],
  ["anon cannot read notes", () => supabaseRest(`${FIXTURE_NOTES}&select=id`), { status: 200, rows: 0 }],
  [
    "another member reads the note",
    () => supabaseRest(`${FIXTURE_NOTES}&select=id`, { as: OTHER_MEMBER }),
    { status: 200, rows: 1 },
  ],
  [
    "another member cannot edit the note",
    () =>
      supabaseRest(FIXTURE_NOTES, {
        as: OTHER_MEMBER,
        method: "PATCH",
        prefer: "return=representation",
        body: { pros: "smoke: nadpisane przez innego członka" },
      }),
    { status: 200, rows: 0 },
  ],
  [
    "another member cannot delete the note",
    () => supabaseRest(FIXTURE_NOTES, { as: OTHER_MEMBER, method: "DELETE", prefer: "return=representation" }),
    { status: 200, rows: 0 },
  ],
  [
    "another member cannot write a note as its author",
    () => writeNoteAsAnotherAuthor(),
    { status: 403, errorCode: "42501" },
  ],
  [
    "note is unchanged after the other member's attempts",
    () => supabaseRest(`${FIXTURE_NOTES}&select=pros`, { as: MEMBER }),
    { status: 200, rows: 1, bodyIncludes: NOTE_EDITED },
  ],
  // Cleanup: runs even when a step above failed, because every step runs.
  [
    "fixture offer is deleted with its notes",
    () =>
      supabaseRest(`offers?id=eq.${FIXTURE_OFFER_ID}`, {
        as: MEMBER,
        method: "DELETE",
        prefer: "return=representation",
      }),
    { status: 200, rows: 1 },
  ],
  [
    "notes are gone with the offer",
    () => supabaseRest(`${FIXTURE_NOTES}&select=id`, { as: MEMBER }),
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

function includesAll(body, expected) {
  return [expected].flat().every((text) => (body ?? "").includes(text));
}

let failed = 0;
for (const [name, run, expected] of steps) {
  // A thrown request is a failed step, not the end of the run: the fixture offer's cleanup step must still run.
  const actual = await run().catch((error) => ({ status: 0, location: "", error: error.message }));
  const ok =
    !actual.error &&
    actual.status === expected.status &&
    (expected.location === undefined || actual.location === expected.location) &&
    (expected.locationPrefix === undefined || actual.location.startsWith(expected.locationPrefix)) &&
    (expected.errorCode === undefined || actual.errorCode === expected.errorCode) &&
    (expected.bodyIncludes === undefined || includesAll(actual.body, expected.bodyIncludes)) &&
    (expected.rows === undefined || actual.rows === expected.rows) &&
    (expected.minRows === undefined || (actual.rows !== undefined && actual.rows >= expected.minRows));
  const rows = actual.rows === undefined ? undefined : `${actual.rows} row(s)`;
  const detail = actual.error ?? `${actual.status} ${actual.errorCode ?? rows ?? actual.location}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${detail}`);
  if (!ok) {
    failed++;
    console.log(
      `      expected ${expected.status} ${expected.errorCode ?? expected.location ?? expected.locationPrefix ?? expected.bodyIncludes ?? expectedRows(expected)}`,
    );
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
