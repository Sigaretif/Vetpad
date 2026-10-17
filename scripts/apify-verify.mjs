// Live verification of the Apify fallback (change `otodom-apify-fallback`, Phase 3): the one place
// in that change that sends a request to Apify or to otodom.pl, and the one place that keeps the
// budget, the pacing and the record of those requests — so a run nobody watches cannot exceed them.
//
// The request is the committed one: `buildApifyRequest` from src/lib/otodom/apify-request.ts, and
// the answer is read the way src/lib/otodom/apify.ts reads it — `readApifyAnswer`, then
// `classifyAnswer` and `classifyPayload` from fetch.ts. That module itself reads `astro:env` and
// cannot load under Node, so its few lines of combination are repeated in `apifyLeg` below; the
// taxonomy is never repeated. Zero dependencies: the modules load through Node's type stripping,
// the way scripts/otodom-inspect.mjs loads them.
//
// Never run in CI, in `npm test`, in smoke or in Playwright. Only conclusions enter the repository:
// the record holds listing ID tokens, never an address or listing text, and raw answers go to a
// directory outside it. The token travels in the Authorization header alone and is never printed.

/* global AbortSignal, URL, setTimeout */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  APIFY_AD_KEYS,
  APIFY_LOCATION_KEYS,
  APIFY_TARGET_KEYS,
  buildApifyRequest,
  readApifyAnswer,
} from "../src/lib/otodom/apify-request.ts";
import { APIFY_CLIENT_DEADLINE_MS, INGEST_ACTION_BUDGET_MS } from "../src/lib/otodom/deadlines.ts";
import { classifyAnswer, classifyPayload, fetchOfferAd, isAbort } from "../src/lib/otodom/fetch.ts";
import { mapAdToOffer } from "../src/lib/otodom/map.ts";
import { normalizeOfferUrl } from "../src/lib/otodom/url.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOG = join(REPO_ROOT, "context/changes/otodom-apify-fallback/live-calls.md");
const LOG_PATH = process.env.APIFY_VERIFY_LOG ? resolve(process.env.APIFY_VERIFY_LOG) : DEFAULT_LOG;

const LIMIT = 15;
const RAISED_LIMIT = 25;
const SPACING_MS = 30_000;
// Sleeping a second past the spacing keeps `--check-log` from judging a clock tick.
const SPACING_MARGIN_MS = 1_000;

const TARGETS = ["otodom", "apify"];

/**
 * Every case: which targets it calls in order, whether it reaches otodom, which address it uses,
 * and the fixed purpose of each of its rows. A purpose is one of these strings and nothing else,
 * so `--check-log` can tell a purpose from listing text.
 */
const CASES = {
  "invalid-token": {
    address: "SALE",
    reaches: false,
    purposes: { apify: "junk token refused before a run starts" },
  },
  sale: {
    address: "SALE",
    reaches: true,
    purposes: {
      otodom: "direct ad of a flat for sale, the reference for the comparison",
      apify: "Apify ad of the same flat, compared key-wise and through mapAdToOffer",
    },
  },
  rental: { address: "RENTAL", reaches: true, purposes: { apify: "flat for rent refused by the gate" } },
  expired: { address: "EXPIRED", reaches: true, purposes: { apify: "expired offer read as not_found" } },
  redirect: {
    address: "SALE",
    reaches: true,
    purposes: { apify: "sale address with an altered slug lands on the same listing" },
  },
  "run-timeout": {
    address: "SALE",
    reaches: true,
    purposes: { apify: "run timeout of 1 s, answered without reaching otodom" },
  },
};
const RAISE_CASE = "raise-budget";
const RAISE_PURPOSE = "budget raised once to 25";
const SKIP_PURPOSE = "no call made";
const ALL_PURPOSES = new Set([
  RAISE_PURPOSE,
  SKIP_PURPOSE,
  ...Object.values(CASES).flatMap((c) => Object.values(c.purposes)),
]);

const COLUMNS = ["time", "target", "case", "purpose", "listing", "billed", "reached_otodom", "result", "cost", "count"];

const HEADER = `# Live calls — otodom-apify-fallback

Written by \`scripts/apify-verify.mjs\`, row by row: each row is written before its call, with the
result \`pending\`, and completed after it. Do not edit a row by hand except to fill in \`cost\`
(Console → Runs → Usage, plan prerequisite P5).

## Limits

- Apify: ${LIMIT} requests (every request sent to the Apify API, billed or not), raised once to ${RAISED_LIMIT}
  by one \`raise-budget\` row.
- otodom direct: ${LIMIT} requests, raised once to ${RAISED_LIMIT} the same way.

## Rules

- Calls are sequential; two requests that may reach otodom are at least 30 s apart.
- A case runs once per target and listing; a repeat prints \`ALREADY_RECORDED\` and calls nothing.
- The first 403, 429 or \`cf-mitigated\` answer from otodom, on either leg, is \`BLOCKED\`: nothing
  that reaches otodom is called after it.
- \`SKIPPED\` (no token or no address) and \`BLOCKED\` rows that are not calls carry \`-\` in
  \`billed\` and \`reached_otodom\` and count toward no limit.
- \`listing\` holds the listing's ID token only. No row holds an address, a path or listing text.
- In \`result\`, the token values \`http\` and \`http_denied\` are written \`HTTP\` and \`HTTP_denied\`,
  so that no row contains the lowercase scheme.

## Calls
`;

const TOKEN_KEY = /^[a-z_]+$/;
const TOKEN_VALUE = /^[A-Za-z0-9_.,:-]+$/;
const BARE_WORD = /^(?:[A-Z_]+|pending)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LISTING_TOKEN = /^ID[A-Za-z0-9]+$/;
const SLUG_TOKEN = /(?:^|-)(ID[A-Za-z0-9]+)$/;
const COST = /^[\s$0-9.,~<>=A-Za-z-]*$/;

const USAGE = `Usage: node --env-file-if-exists=.env scripts/apify-verify.mjs --case <name>
       node scripts/apify-verify.mjs --check-log
       node scripts/apify-verify.mjs --check-expected
       node scripts/apify-verify.mjs --raise-budget <apify|otodom>

Cases: ${Object.keys(CASES).join(", ")}. Each makes at most one call per target and records it.
Inputs: APIFY_TOKEN, APIFY_VERIFY_SALE_URL, APIFY_VERIFY_RENTAL_URL, APIFY_VERIFY_EXPIRED_URL.
The record is context/changes/otodom-apify-fallback/live-calls.md, or APIFY_VERIFY_LOG when set.
Raw answers go to APIFY_VERIFY_OUT, or to the system's temporary directory - never the repository.

Exit codes: 0 call made, ALREADY_RECORDED, SKIPPED or BLOCKED; 1 the record is missing, malformed
or breaks a rule, or an expected result did not occur; 2 the budget is exhausted or usage error.`;

class LogError extends Error {}

// ---------------------------------------------------------------- the record

/** A value the record may hold: no character outside the token set, and no lowercase scheme. */
function tok(value) {
  const text = String(value).replace(/[^A-Za-z0-9_.,:-]/g, "_");
  return (text === "" ? "_" : text).replaceAll("http", "HTTP");
}

function fromLog(value) {
  return value.replaceAll("HTTP", "http");
}

function formatResult(fields, words = []) {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${tok(value)}`);
  return [...words, ...pairs].join(" ");
}

function parseResult(result) {
  const words = new Set();
  const fields = {};
  for (const part of result.split(/\s+/).filter((p) => p !== "")) {
    const eq = part.indexOf("=");
    if (eq < 0) words.add(part);
    else fields[part.slice(0, eq)] = fromLog(part.slice(eq + 1));
  }
  return { words, fields };
}

function isCallRow(row) {
  return row.billed !== "-";
}

function isCompleted(row) {
  return row.result !== "pending";
}

function readLog() {
  if (!existsSync(LOG_PATH)) return null;
  const lines = readFileSync(LOG_PATH, "utf8").split("\n");
  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const headerAt = lines.findIndex(
    (line) => line.trim().startsWith("|") && splitRow(line).join(",") === COLUMNS.join(","),
  );
  if (headerAt < 0) throw new LogError("the table header is missing or its columns differ");
  if (!/^\|[\s:|-]+\|$/.test((lines[headerAt + 1] ?? "").trim()))
    throw new LogError("the table's separator line is missing");
  const rows = [];
  for (const [index, line] of lines.slice(headerAt + 2).entries()) {
    if (!line.trim().startsWith("|")) break;
    const cells = splitRow(line);
    if (cells.length !== COLUMNS.length) {
      throw new LogError(`row ${index + 1} has ${cells.length} cells, not ${COLUMNS.length}`);
    }
    const row = Object.fromEntries(COLUMNS.map((column, i) => [column, cells[i]]));
    rows.push({ ...row, reached: row.reached_otodom, line: line.trim(), number: index + 1 });
  }
  return rows;
}

function writeLog(rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  const table = [
    line(COLUMNS),
    line(COLUMNS.map(() => "---")),
    ...rows.map((row) => line(COLUMNS.map((column) => (column === "reached_otodom" ? row.reached : row[column])))),
  ];
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${HEADER}\n${table.join("\n")}\n`);
}

function limitOf(rows, target) {
  return rows.some((row) => row.case === RAISE_CASE && row.target === target) ? RAISED_LIMIT : LIMIT;
}

function callsTo(rows, target) {
  return rows.filter((row) => isCallRow(row) && row.target === target).length;
}

function isBlockedRow(row) {
  return isCallRow(row) && parseResult(row.result).words.has("BLOCKED");
}

/** Every rule the record must keep. An empty list means it keeps them. */
function problemsOf(rows) {
  const problems = [];
  const at = (row, text) => problems.push(`row ${row.number}: ${text}`);
  for (const row of rows) {
    if (row.line.includes("http") || row.line.includes("://")) at(row, "contains a scheme");
    if (/otodom\.pl\//i.test(row.line) || /\/oferta\//i.test(row.line)) at(row, "contains an address");
    if (!ISO_TIME.test(row.time) || Number.isNaN(Date.parse(row.time))) at(row, "time is not an ISO time");
    if (!TARGETS.includes(row.target)) at(row, "unknown target");
    if (row.case === "" || (row.case !== RAISE_CASE && !(row.case in CASES))) at(row, "unknown or missing case");
    if (row.purpose === "" || !ALL_PURPOSES.has(row.purpose)) at(row, "unknown or missing purpose");
    if (row.listing !== "-" && !LISTING_TOKEN.test(row.listing)) at(row, "listing is not an ID token");
    if (!["yes", "no", "unknown", "pending", "-"].includes(row.billed)) at(row, "billed is not yes/no/unknown");
    if (!["yes", "no", "-"].includes(row.reached)) at(row, "reached_otodom is not yes/no");
    if ((row.billed === "-") !== (row.reached === "-")) at(row, "billed and reached_otodom disagree on being a call");
    if (row.case === RAISE_CASE && isCallRow(row)) at(row, "a raise is not a call");
    if (!/^(?:\d+\/\d+|-)$/.test(row.count)) at(row, "count is not n/limit");
    if (!COST.test(row.cost)) at(row, "cost holds unexpected characters");
    for (const part of row.result.split(/\s+/).filter((p) => p !== "")) {
      const eq = part.indexOf("=");
      const ok =
        eq < 0 ? BARE_WORD.test(part) : TOKEN_KEY.test(part.slice(0, eq)) && TOKEN_VALUE.test(part.slice(eq + 1));
      if (!ok) at(row, `result token is not a token: ${tok(part).slice(0, 40)}`);
    }
    if (row.result === "") at(row, "result is empty");
    if (row.result === "pending") at(row, "the call's result was never recorded (pending)");
  }
  for (const target of TARGETS) {
    const raises = rows.filter((row) => row.case === RAISE_CASE && row.target === target).length;
    if (raises > 1) problems.push(`${target}: ${raises} raises, at most one is allowed`);
    const calls = callsTo(rows, target);
    if (calls > limitOf(rows, target))
      problems.push(`${target}: ${calls} calls over the limit ${limitOf(rows, target)}`);
  }
  let previous = null;
  for (const row of rows.filter((r) => isCallRow(r) && r.reached === "yes")) {
    if (previous !== null && Date.parse(row.time) - Date.parse(previous.time) < SPACING_MS) {
      at(row, `less than 30 s after row ${previous.number}, both reaching otodom`);
    }
    previous = row;
  }
  const seen = new Set();
  for (const row of rows.filter((r) => isCallRow(r) && isCompleted(r))) {
    const key = `${row.target}/${row.case}/${row.listing}`;
    if (seen.has(key)) at(row, `a second completed call for ${key}`);
    seen.add(key);
  }
  const blockedAt = rows.findIndex(isBlockedRow);
  if (blockedAt >= 0) {
    for (const row of rows.slice(blockedAt + 1)) {
      if (isCallRow(row) && row.reached === "yes") at(row, "reaches otodom after a BLOCKED row");
    }
  }
  return problems;
}

function loadValidLog({ create }) {
  let rows;
  try {
    rows = readLog();
  } catch (error) {
    if (error instanceof LogError) fail(`MALFORMED record: ${error.message}`);
    throw error;
  }
  if (rows === null) {
    if (!create) fail(`MISSING record: ${relativeToRepo(LOG_PATH)} does not exist`);
    rows = [];
    writeLog(rows);
  }
  const problems = problemsOf(rows);
  if (problems.length > 0) fail(`The record breaks the rules:\n  ${problems.join("\n  ")}`);
  return rows;
}

function relativeToRepo(path) {
  const rel = relative(REPO_ROOT, path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ---------------------------------------------------------------- what each case expects

/**
 * The verdict on one case from its rows alone: PASS, STALE, SKIPPED, BLOCKED, MISMATCH, NOT_RUN or
 * INTERRUPTED. Shared by `--case` (to print it) and `--check-expected` (to judge it).
 */
function judgeCase(name, allRows) {
  const rows = allRows.filter((row) => row.case === name);
  const calls = rows.filter(isCallRow);
  if (calls.some((row) => !isCompleted(row))) return { verdict: "INTERRUPTED", why: "a call has no recorded result" };
  if (calls.some(isBlockedRow)) return { verdict: "BLOCKED", why: "otodom refused a request" };
  const result = (target) => {
    const row = calls.find((r) => r.target === target);
    return row === undefined ? undefined : parseResult(row.result).fields;
  };
  const a = result("apify");
  if (name === "sale") {
    const d = result("otodom");
    if (d !== undefined && (d.reason === "not_found" || d.status === "410")) {
      return { verdict: "STALE", why: "the sale listing answered not_found; replace its address in .env" };
    }
    if (d !== undefined && d.reason !== "ok") return { verdict: "MISMATCH", why: `direct fetch ended ${d.reason}` };
  }
  if (a === undefined) {
    const last = rows.filter((row) => !isCallRow(row)).at(-1);
    if (last !== undefined) {
      const { words } = parseResult(last.result);
      if (words.has("SKIPPED")) return { verdict: "SKIPPED", why: last.result };
      if (words.has("BLOCKED")) return { verdict: "BLOCKED", why: "refused after an earlier BLOCKED" };
    }
    return { verdict: "NOT_RUN", why: "no completed call recorded" };
  }
  const goneWhenLive = a.reason === "not_found" || a.status === "410";
  const judged = (pass, expected) =>
    pass ? { verdict: "PASS", why: expected } : { verdict: "MISMATCH", why: `expected ${expected}` };
  switch (name) {
    case "invalid-token":
      return judged(
        a.apify_status === "401" && a.apify_error === "user-or-token-not-found" && a.apify_failure === "http",
        "401 user-or-token-not-found, apify_failure http",
      );
    case "sale":
      if (goneWhenLive)
        return { verdict: "STALE", why: "the sale listing answered not_found; replace its address in .env" };
      return judged(
        a.reason === "ok" && a.keys_equal === "yes" && a.extra_keys === "none" && a.mapped_equal === "yes",
        "listed keys equal, no extra keys, mapAdToOffer outputs equal",
      );
    case "rental":
      if (goneWhenLive)
        return { verdict: "STALE", why: "the rental listing answered not_found; replace its address in .env" };
      return judged(a.reason === "ok" && a.gate === "not_for_sale", "gate not_for_sale");
    case "expired":
      if (a.status === "200")
        return { verdict: "STALE", why: "the expired listing answered 200; replace its address in .env" };
      return judged(a.status === "410" && a.reason === "not_found", "status 410, reason not_found");
    case "redirect":
      if (goneWhenLive)
        return { verdict: "STALE", why: "the sale listing answered not_found; replace its address in .env" };
      return judged(a.reason === "ok" && a.landing === "offer_same", "accepted, landing on the same listing token");
    case "run-timeout":
      return judged(
        // The user's decision of 2026-10-17: 400 run-failed is the observed shape (Console: TIMED-OUT).
        a.apify_failure === "http" && a.apify_status === "400" && a.apify_error === "run-failed",
        "an Apify failure before otodom: http 400 run-failed",
      );
    default:
      return { verdict: "MISMATCH", why: "unknown case" };
  }
}

// ---------------------------------------------------------------- the two legs

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listingToken(normalizedUrl) {
  const slug =
    new URL(normalizedUrl).pathname
      .split("/")
      .filter((s) => s !== "")
      .at(-1) ?? "";
  return SLUG_TOKEN.exec(slug)?.[1];
}

/** Where Apify's request ended, as a kind: never the address. */
function landingKind(loadedUrl, requestedToken) {
  if (loadedUrl === "") return "unknown";
  if (!URL.canParse(loadedUrl)) return "unparseable";
  const landed = new URL(loadedUrl);
  if (!["otodom.pl", "www.otodom.pl"].includes(landed.hostname)) return "off_otodom";
  if (/^\/(?:pl\/)?wyniki(?:\/|$)/.test(landed.pathname)) return "results";
  if (/^\/(?:pl\/)?oferta\/[^/]+\/?$/.test(landed.pathname)) {
    return listingToken(`https://www.otodom.pl${landed.pathname.replace(/\/$/, "")}`) === requestedToken
      ? "offer_same"
      : "offer_other";
  }
  return "elsewhere";
}

function outDir() {
  const dir = resolve(process.env.APIFY_VERIFY_OUT || join(tmpdir(), "vetpad-apify-verify"));
  const rel = relative(REPO_ROOT, dir);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    fail("APIFY_VERIFY_OUT lies inside the repository; raw answers never go there");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveRaw(name, data) {
  writeFileSync(join(outDir(), name), JSON.stringify(data, null, 2));
}

function readRaw(name) {
  const path = join(outDir(), name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function gateOf(ad) {
  const mapped = mapAdToOffer(ad);
  return mapped.ok ? "pass" : mapped.reason;
}

/** One direct fetch, through the module the routes use (its own headers and User-Agent). */
async function directLeg(normalizedUrl) {
  const result = await fetchOfferAd(normalizedUrl, AbortSignal.timeout(INGEST_ACTION_BUDGET_MS));
  if (result.ok) {
    return {
      result,
      fields: {
        status: 200,
        landing: "offer",
        reason: "ok",
        gate: gateOf(result.ad),
        ad_keys: Object.keys(result.ad).length,
      },
    };
  }
  const blocked = result.status === 403 || result.status === 429 || result.reason === "challenged";
  return {
    result,
    blocked,
    fields: { status: result.status ?? "none", reason: result.reason, detail: result.detail },
  };
}

/**
 * One Apify run, read exactly as src/lib/otodom/apify.ts reads it: `readApifyAnswer`, then, for an
 * item, `classifyAnswer` and `classifyPayload` on what the item knows.
 */
async function apifyLeg({ token, normalizedUrl, startUrl = normalizedUrl, runTimeoutS, rawName }) {
  const request = buildApifyRequest(startUrl);
  const address = new URL(request.url);
  if (runTimeoutS !== undefined) address.searchParams.set("timeout", String(runTimeoutS));
  const signal = AbortSignal.timeout(APIFY_CLIENT_DEADLINE_MS);
  let response;
  try {
    response = await fetch(address, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    return { billed: "unknown", fields: { apify_failure: isAbort(error, signal) ? "timeout" : "network" } };
  }
  const apifyStatus = response.status;
  let text;
  try {
    text = await response.text();
  } catch (error) {
    return {
      billed: "unknown",
      fields: { apify_status: apifyStatus, apify_failure: isAbort(error, signal) ? "timeout" : "network" },
    };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  saveRaw(rawName, { apifyStatus, body: json === undefined ? null : json });
  const billed = (apifyStatus >= 200 && apifyStatus <= 299) || apifyStatus === 408 ? "yes" : "no";

  const answer = readApifyAnswer(apifyStatus, json, startUrl);
  if (!answer.ok) {
    if (answer.apifyFailure === "run_error") {
      return { billed, fields: { apify_status: apifyStatus, apify_failure: "run_error", reason: "http_denied" } };
    }
    return {
      billed,
      fields: { apify_status: apifyStatus, apify_error: answer.apifyErrorType, apify_failure: answer.apifyFailure },
    };
  }
  const { item } = answer;
  const landing = landingKind(item.loadedUrl, listingToken(startUrl));
  const base = { apify_status: apifyStatus, status: item.status, landing };
  const blocked = item.status === 403 || item.status === 429;
  const { failure, answered } = classifyAnswer({
    status: item.status,
    requestedUrl: startUrl,
    landedUrl: item.loadedUrl,
  });
  if (failure !== null)
    return { billed, blocked, item, fields: { ...base, reason: failure.reason, detail: failure.detail } };
  const result = classifyPayload(item, answered);
  if (!result.ok) return { billed, blocked, item, fields: { ...base, reason: result.reason, detail: result.detail } };
  return { billed, item, ad: result.ad, fields: { ...base, reason: "ok", gate: gateOf(result.ad) } };
}

function jsonEqual(a, b) {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)));
}

/**
 * The sale case's comparison. The keys compared come from the exported lists, never from the
 * Apify item, so a key Apify dropped is still compared; a key outside the lists is a leak.
 */
function compareAds(direct, apify) {
  const missing = [];
  const differing = [];
  const compare = (name, from, to) => {
    if (!(name in to)) missing.push(name);
    else if (!jsonEqual(from, to[name])) differing.push(name);
  };
  for (const key of APIFY_AD_KEYS) if (key in direct) compare(key, direct[key], apify);
  for (const [parent, keys] of [
    ["location", APIFY_LOCATION_KEYS],
    ["target", APIFY_TARGET_KEYS],
  ]) {
    if (!isRecord(direct[parent])) continue;
    const to = isRecord(apify[parent]) ? apify[parent] : {};
    for (const key of keys) {
      if (!(key in direct[parent])) continue;
      if (!(key in to)) missing.push(`${parent}.${key}`);
      else if (!jsonEqual(direct[parent][key], to[key])) differing.push(`${parent}.${key}`);
    }
  }
  const allowed = new Set([...APIFY_AD_KEYS, "location", "target"]);
  const extra = Object.keys(apify).filter((key) => !allowed.has(key));
  for (const [parent, keys] of [
    ["location", APIFY_LOCATION_KEYS],
    ["target", APIFY_TARGET_KEYS],
  ]) {
    if (isRecord(apify[parent])) {
      extra.push(
        ...Object.keys(apify[parent])
          .filter((k) => !keys.includes(k))
          .map((k) => `${parent}.${k}`),
      );
    }
  }
  const directMapped = mapAdToOffer(direct);
  const apifyMapped = mapAdToOffer(apify);
  const list = (names) => (names.length === 0 ? "none" : names.join(","));
  return {
    keys_equal: missing.length === 0 && differing.length === 0 ? "yes" : "no",
    missing_keys: list(missing),
    differing_keys: list(differing),
    extra_keys: list(extra),
    mapped_equal: isDeepStrictEqual(directMapped, apifyMapped) ? "yes" : "no",
  };
}

// ---------------------------------------------------------------- one case

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** Waits until the previous request that may have reached otodom is 30 s behind, and `notBefore` too. */
async function pace(rows, notBefore = 0) {
  const last = rows.filter((row) => isCallRow(row) && row.reached === "yes").at(-1);
  const after = Math.max(last === undefined ? 0 : Date.parse(last.time) + SPACING_MS + SPACING_MARGIN_MS, notBefore);
  const wait = after - Date.now();
  if (wait > 0) {
    console.log(`pacing: waiting ${Math.ceil(wait / 1000)} s before a request that may reach otodom`);
    await sleep(wait);
  }
}

function appendNote(rows, row) {
  // A note repeated by a re-run is not written twice.
  const last = rows.filter((r) => r.case === row.case && !isCallRow(r)).at(-1);
  if (last !== undefined && last.result === row.result && last.target === row.target) return;
  rows.push({ ...row, time: new Date().toISOString(), billed: "-", reached: "-", cost: "", count: "-" });
  writeLog(rows);
}

/** Writes the row before the call, makes the call, and completes the row whatever happens. */
async function recordedCall(rows, { target, caseName, listing, reached }, call) {
  const row = {
    time: new Date().toISOString(),
    target,
    case: caseName,
    purpose: CASES[caseName].purposes[target],
    listing,
    billed: "pending",
    reached,
    result: "pending",
    cost: "",
    count: `${callsTo(rows, target) + 1}/${limitOf(rows, target)}`,
  };
  rows.push(row);
  writeLog(rows);
  try {
    const outcome = await call();
    row.billed = target === "otodom" ? "no" : outcome.billed;
    row.result = formatResult(outcome.fields, outcome.blocked ? ["BLOCKED"] : []);
    return outcome;
  } catch (error) {
    row.billed = target === "otodom" ? "no" : "unknown";
    row.result = formatResult({ reason: "script_error", error: error instanceof Error ? error.name : "unknown" }, [
      "ERROR",
    ]);
    throw error;
  } finally {
    writeLog(rows);
  }
}

function printRow(row) {
  console.log(`${row.case} / ${row.target}: ${fromLog(row.result)}`);
}

function printVerdict(caseName, rows) {
  const { verdict, why } = judgeCase(caseName, rows);
  console.log(`verdict: ${verdict} (${fromLog(why)})`);
}

async function runCase(caseName) {
  const spec = CASES[caseName];
  const rows = loadValidLog({ create: true });
  const targets = Object.keys(spec.purposes);
  const mine = rows.filter((row) => row.case === caseName && isCallRow(row));
  const done = (target) => mine.find((row) => row.target === target && isCompleted(row));

  if (mine.some((row) => !isCompleted(row))) fail(`INTERRUPTED: ${caseName} has a call with no recorded result`);
  const directFailed =
    caseName === "sale" && done("otodom") && parseResult(done("otodom").result).fields.reason !== "ok";
  if (targets.every(done) || directFailed || mine.some(isBlockedRow)) {
    console.log("ALREADY_RECORDED");
    mine.forEach(printRow);
    printVerdict(caseName, rows);
    return;
  }

  const token = process.env.APIFY_TOKEN?.trim();
  const rawAddress = process.env[`APIFY_VERIFY_${spec.address}_URL`]?.trim();
  const skip = (reason) => {
    appendNote(rows, {
      target: "apify",
      case: caseName,
      purpose: SKIP_PURPOSE,
      listing: "-",
      result: formatResult({ reason }, ["SKIPPED"]),
    });
    console.log(`SKIPPED: ${reason}`);
  };
  if (!token) return skip("no_apify_token");
  if (!rawAddress) return skip(`no_${spec.address.toLowerCase()}_address`);
  const normalized = normalizeOfferUrl(rawAddress);
  if (!normalized.ok) return skip(`address_rejected_${normalized.reason}`);
  const listing = listingToken(normalized.url);
  if (listing === undefined) return skip("address_without_id_token");

  if (spec.reaches && rows.some(isBlockedRow)) {
    appendNote(rows, { target: "apify", case: caseName, purpose: SKIP_PURPOSE, listing, result: "BLOCKED" });
    console.log("BLOCKED: otodom refused an earlier request; no call made");
    return;
  }
  for (const target of targets.filter((t) => !done(t))) {
    if (callsTo(rows, target) + 1 > limitOf(rows, target)) {
      fail(`BUDGET_EXHAUSTED: ${target} has used ${callsTo(rows, target)}/${limitOf(rows, target)}`, 2);
    }
  }

  const reached = spec.reaches ? "yes" : "no";
  const rawStem = `${caseName}-${listing}-${Date.now()}`;

  if (caseName === "invalid-token") {
    const junk = `apify_api_invalid${randomBytes(12).toString("hex")}`;
    await recordedCall(rows, { target: "apify", caseName, listing, reached }, () =>
      apifyLeg({ token: junk, normalizedUrl: normalized.url, rawName: `${rawStem}-apify.json` }),
    );
    printRow(rows.at(-1));
    printVerdict(caseName, rows);
    return;
  }

  let directAd;
  let directEnded = 0;
  if (caseName === "sale") {
    const directRaw = `sale-direct-ad-${listing}.json`;
    if (done("otodom")) {
      directAd = readRaw(directRaw);
      if (directAd === undefined) fail(`CANNOT_RESUME: the direct ad of ${listing} is not in the output directory`);
    } else {
      await pace(rows);
      const direct = await recordedCall(rows, { target: "otodom", caseName, listing, reached: "yes" }, () =>
        directLeg(normalized.url),
      );
      directEnded = Date.now();
      printRow(rows.at(-1));
      if (direct.result.ok) {
        directAd = direct.result.ad;
        saveRaw(directRaw, directAd);
        console.log(`direct ad keys: ${Object.keys(directAd).join(", ")}`);
      }
      if (direct.blocked) {
        console.log("BLOCKED: otodom refused the direct request; the Apify leg is not called");
        printVerdict(caseName, rows);
        return;
      }
      if (!direct.result.ok) {
        printVerdict(caseName, rows);
        return;
      }
    }
  }

  let startUrl = normalized.url;
  if (caseName === "redirect") {
    // The same listing under another slug. `normalizeOfferUrl` keeps a slug as written, so the
    // altered one is what Apify is sent.
    startUrl = normalized.url.replace(/\/oferta\/[^/]+$/, `/oferta/zmieniony-adres-${listing}`);
  }
  await pace(rows, directEnded === 0 ? 0 : directEnded + SPACING_MS + SPACING_MARGIN_MS);
  const outcome = await recordedCall(rows, { target: "apify", caseName, listing, reached }, async () => {
    const leg = await apifyLeg({
      token,
      normalizedUrl: normalized.url,
      startUrl,
      runTimeoutS: caseName === "run-timeout" ? 1 : undefined,
      rawName: `${rawStem}-apify.json`,
    });
    if (caseName === "redirect") leg.fields.slug_sent = startUrl === normalized.url ? "unchanged" : "altered";
    if (caseName === "sale" && leg.ad !== undefined) Object.assign(leg.fields, compareAds(directAd, leg.ad));
    return leg;
  });
  printRow(rows.at(-1));
  if (outcome.ad !== undefined) console.log(`apify ad keys: ${Object.keys(outcome.ad).join(", ")}`);
  if (outcome.blocked) console.log("BLOCKED: otodom refused Apify's request; later otodom-reaching cases call nothing");
  if (outcome.item !== undefined) {
    const { markerPresent, parseError, pagePropsPresent, pagePropsExpired } = outcome.item;
    console.log(
      `item: markerPresent=${markerPresent} parseError=${parseError} pagePropsPresent=${pagePropsPresent} pagePropsExpired=${pagePropsExpired}`,
    );
  }
  printVerdict(caseName, rows);
}

// ---------------------------------------------------------------- the offline modes

function checkLog() {
  const rows = loadValidLog({ create: false });
  for (const target of TARGETS) console.log(`${target}: ${callsTo(rows, target)}/${limitOf(rows, target)} calls`);
  console.log(`OK: ${rows.length} rows keep the budget, the pacing and the record's rules`);
}

function checkExpected() {
  const rows = loadValidLog({ create: false });
  let failed = false;
  for (const caseName of Object.keys(CASES)) {
    const { verdict, why } = judgeCase(caseName, rows);
    console.log(`${caseName.padEnd(14)} ${verdict.padEnd(11)} ${fromLog(why)}`);
    if (!["PASS", "STALE", "SKIPPED", "BLOCKED"].includes(verdict)) failed = true;
  }
  if (failed) fail("FAIL: a case did not end as expected; follow the STRUCTURAL rule, do not adjust the expectations");
  console.log("OK: every case passed, or is SKIPPED, BLOCKED or STALE");
}

function raiseBudget(target) {
  if (!TARGETS.includes(target)) fail(USAGE, 2);
  const rows = loadValidLog({ create: true });
  if (rows.some((row) => row.case === RAISE_CASE && row.target === target)) {
    fail(`RAISE_ALREADY_USED: ${target} was raised once already; the remainder is a Manual row`);
  }
  rows.push({
    time: new Date().toISOString(),
    target,
    case: RAISE_CASE,
    purpose: RAISE_PURPOSE,
    listing: "-",
    billed: "-",
    reached: "-",
    result: formatResult({ limit: RAISED_LIMIT }, ["RAISED"]),
    cost: "",
    count: "-",
  });
  writeLog(rows);
  console.log(`RAISED: ${target} limit is now ${RAISED_LIMIT}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "--help" || mode === "-h") {
  console.log(USAGE);
} else if (mode === "--check-log") {
  checkLog();
} else if (mode === "--check-expected") {
  checkExpected();
} else if (mode === "--case" && arg in CASES) {
  await runCase(arg);
} else if (mode === "--raise-budget" && arg !== undefined) {
  raiseBudget(arg);
} else {
  fail(USAGE, 2);
}
