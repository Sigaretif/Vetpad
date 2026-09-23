// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// that registration is closed both in the app and in Supabase Auth (FR-001), and that /api/offers refuses
// anonymous callers and URLs that are not otodom.pl offers before any request reaches otodom.pl.
// It also checks that the dev-only kitchen sink /dev/offer-card answers 404: in CI this runs against the
// production preview, where the page must not exist (on `npm run dev` that step fails by design).
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 npm run smoke

import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
// Default credentials are the first team account seeded by supabase/seed.sql (local database only).
const email = process.env.SMOKE_EMAIL ?? "sigaretif1@vetpad.local";
const password = process.env.SMOKE_PASSWORD ?? "qwerty123456";
const jar = new Map();

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
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

async function supabaseSignup() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { status: 0, location: "", error: "SUPABASE_URL and SUPABASE_KEY must be set (e.g. in .env)" };
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `smoke-${Date.now()}@example.com`, password: "Smoke-Test-Passw0rd!" }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, location: "", errorCode: body.error_code ?? "" };
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["signup page is gone", () => request("/auth/signup"), { status: 404 }],
  ["dev kitchen sink is absent from the build", () => request("/dev/offer-card"), { status: 404 }],
  [
    "signup route is gone",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 404 },
  ],
  ["supabase auth rejects signup", () => supabaseSignup(), { status: 422, errorCode: "signup_disabled" }],
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
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    !actual.error &&
    actual.status === expected.status &&
    (expected.location === undefined || actual.location === expected.location) &&
    (expected.locationPrefix === undefined || actual.location.startsWith(expected.locationPrefix)) &&
    (expected.errorCode === undefined || actual.errorCode === expected.errorCode);
  const detail = actual.error ?? `${actual.status} ${actual.errorCode ?? actual.location}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${detail}`);
  if (!ok) {
    failed++;
    console.log(
      `      expected ${expected.status} ${expected.errorCode ?? expected.location ?? expected.locationPrefix ?? ""}`,
    );
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
