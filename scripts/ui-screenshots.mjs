// Debugging aid for UI changes: signs in with a seeded account, opens each page of a set in
// headless Chrome, scrolls it so lazy images load, and saves full-page PNGs for the visual gate.
// Zero dependencies on purpose: it drives Chrome over the DevTools Protocol with Node's built-in
// WebSocket. Needs a running dev server and google-chrome (or CHROME=<path>). Never runs in CI.
//
//   node scripts/ui-screenshots.mjs <set> <outDir>

/* global WebSocket, setTimeout */

import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const CHROME = process.env.CHROME ?? "google-chrome";
const DEBUG_PORT = 9334;
// Default credentials are the first team account seeded by supabase/seed.sql (local database only).
const email = process.env.SMOKE_EMAIL ?? "sigaretif1@vetpad.local";
const password = process.env.SMOKE_PASSWORD ?? "qwerty123456";
const OFFER = `/offers/${process.env.OFFER_ID ?? "8360a2e2-264f-48ab-aaaf-894984275c42"}`;
const KITCHEN_SINK = "/dev/offer-card";
const FORMS_KITCHEN_SINK = "/dev/forms";
const BOARD_KITCHEN_SINK = "/dev/board";
const CRITERIA_KITCHEN_SINK = "/dev/criteria";
const ERRORS_KITCHEN_SINK = "/dev/errors";

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };

// Focus targets for the gate, reached with real Tab presses so :focus-visible applies.
// The card links are matched inside a shadcn Card, so a banner link above it is skipped.
const FOCUS = {
  topbar: `el.getAttribute("href") === "/dashboard"`,
  external: `el.matches("[data-slot=card] a[target=_blank]") && !el.querySelector("img")`,
  thumb: `el.matches("[data-slot=card] a") && el.querySelector("img") !== null`,
  banner: `el.matches(".banner a")`,
  // The first „Edytuj" in a notes column: state „pełna oferta", whose own note is in preview.
  noteEdit: `el.matches("[data-notes-state] button") && el.textContent.trim() === "Edytuj"`,
  // The audit section on its own, state „brak audytu": its one button, „Uruchom audyt AI". The
  // sections above it carry audit buttons too, so the match names the state.
  auditRun: `el.matches("[data-state=audit-none] [data-audit-runner] button")`,
  // /dev/forms: the real SignInForm island in the "default" section, reached with real Tab
  // presses; the errored field lives in the "error" section instead (its own composite).
  emailField: `el.matches("[data-state=default] [data-form=signin] input[type=email]")`,
  passwordToggle: `el.matches("[data-state=default] [data-form=signin] button[aria-pressed]")`,
  submitButton: `el.matches("[data-state=default] [data-form=signin] button[type=submit]")`,
  erroredField: `el.matches("[data-state=error] input[aria-invalid=true]")`,
  // The real NoteEditor island in the "default" section: its first field, „Zalety".
  noteField: `el.matches("[data-state=default] [data-form=note] textarea")`,
  // /dev/board: the "default" section only — the other sections carry rows and sort navs too.
  // Tab reaches the section's sort nav before its rows, so the first match is the first link.
  boardRow: `el.matches("[data-state=default] a[href^='/offers/']")`,
  boardSort: `el.matches("[data-state=default] nav[aria-label='Sortowanie ofert'] a")`,
  // /dev/forms: the real TeamLimitsForm island in the "default" section, its first field („Miasto").
  limitsField: `el.matches("[data-state=default] [data-form=limits] input[name=city]")`,
  // /dev/forms: the real AuditSettingsForm island in the "default" section. Its two lists are Radix
  // triggers (button[role=combobox]); Tab reaches „Model" first. The trigger carries a `data-state`
  // of its own (open/closed), which the section's `[data-state=default]` ancestor does not meet.
  auditSelect: `el.matches("[data-state=default] [data-form=audit] button[role=combobox]")`,
  // /dev/criteria: the "full" section only — every section renders the whole view.
  criteriaCity: `el.matches("[data-state=full] [data-criteria-section=limits] input[name=city]")`,
  // The own requirements' „Edytuj" in preview; „Usuń" beside it is a button too.
  requirementsEdit: `el.matches("[data-state=full] [data-criteria-section=requirements] button") && el.textContent.trim() === "Edytuj"`,
  // The audit settings' „Model" list in the same section: the first of its two triggers.
  criteriaAuditModel: `el.matches("[data-state=full] [data-criteria-section=audit] button[role=combobox]")`,
  // /dev/errors: the 503 view's main link, „Spróbuj ponownie"; „Przejdź do logowania" follows it.
  errorsRetry: `el.matches("[data-state='503'] [data-error-page] a") && el.textContent.trim() === "Spróbuj ponownie"`,
};

// A shot is a full page unless `viewport`, `focus` or `hover` says otherwise; `auth: false` drops
// the session. `hover: "<CSS selector>"` forces `:hover` on the matched element via CDP
// (`CSS.forcePseudoState`), so a hover state needs no manual check. `clip: "<CSS selector>"` saves
// only the first element it matches — one state section of a kitchen sink.
const SETS = {
  before: [
    { name: "before-signin", path: "/auth/signin", auth: false },
    { name: "before-home", path: "/", auth: false },
    { name: "before-dashboard", path: "/dashboard" },
    { name: "before-offer-real", path: OFFER },
  ],
  p2: [
    { name: "after-p2-signin", path: "/auth/signin", auth: false },
    { name: "after-p2-home", path: "/", auth: false },
    { name: "after-p2-dashboard", path: "/dashboard" },
  ],
  p3: [
    { name: "after-offer-real", path: OFFER },
    { name: "after-offer-real-duplicate", path: `${OFFER}?duplicate=1`, viewport: true },
    { name: "after-p3-home", path: "/", auth: false },
  ],
  gate: [
    { name: "gate-desktop", path: KITCHEN_SINK },
    { name: "gate-mobile", path: KITCHEN_SINK, device: MOBILE },
    { name: "gate-focus-topbar", path: KITCHEN_SINK, focus: "topbar" },
    { name: "gate-focus-link", path: KITCHEN_SINK, focus: "external" },
    { name: "gate-focus-thumb", path: KITCHEN_SINK, focus: "thumb" },
    { name: "gate-focus-banner", path: KITCHEN_SINK, focus: "banner" },
    { name: "gate-focus-note-edit", path: KITCHEN_SINK, focus: "noteEdit" },
    { name: "gate-hover-note-edit", path: KITCHEN_SINK, hover: "[data-notes-state] [data-slot=card-action] button" },
    // The audit section's 7-state matrix, each state on its own in a column as wide as the team
    // column. default: a result with all four categories, the meta row and the left-out count.
    { name: "gate-audit-default", path: KITCHEN_SINK, clip: "[data-state=audit-default]" },
    // hover and focus: the run button of an offer nobody audited.
    { name: "gate-hover-audit-run", path: KITCHEN_SINK, hover: "[data-state=audit-none] [data-audit-runner] button" },
    { name: "gate-focus-audit-run", path: KITCHEN_SINK, focus: "auditRun" },
    // disabled: no provider key; an attempt in progress, seen by another member.
    { name: "gate-audit-unavailable", path: KITCHEN_SINK, clip: "[data-state=audit-unavailable]" },
    { name: "gate-audit-running", path: KITCHEN_SINK, clip: "[data-state=audit-running]" },
    // error: a failed attempt beside a kept result and with no result, an interrupted attempt, a
    // failed read of the audit, a stored result that does not read, and an answer that is not the
    // audit's stream.
    { name: "gate-audit-failed-kept", path: KITCHEN_SINK, clip: "[data-state=audit-failed-kept]" },
    { name: "gate-audit-failed", path: KITCHEN_SINK, clip: "[data-state=audit-failed]" },
    { name: "gate-audit-interrupted", path: KITCHEN_SINK, clip: "[data-state=audit-interrupted]" },
    { name: "gate-audit-read-error", path: KITCHEN_SINK, clip: "[data-state=audit-read-error]" },
    { name: "gate-audit-result-broken", path: KITCHEN_SINK, clip: "[data-state=audit-result-broken]" },
    { name: "gate-audit-unreadable", path: KITCHEN_SINK, clip: "[data-state=audit-unreadable]" },
    // empty: no audit; a result whose categories are empty.
    { name: "gate-audit-none", path: KITCHEN_SINK, clip: "[data-state=audit-none]" },
    { name: "gate-audit-empty-categories", path: KITCHEN_SINK, clip: "[data-state=audit-empty-categories]" },
    // loading: an audit in progress, with its stage and the running time.
    { name: "gate-audit-progress", path: KITCHEN_SINK, clip: "[data-state=audit-progress]" },
    // A long label, a long excerpt and a long requirement in the narrow column, and at 375 px.
    { name: "gate-audit-long", path: KITCHEN_SINK, clip: "[data-state=audit-long]" },
    { name: "gate-audit-long-mobile", path: KITCHEN_SINK, clip: "[data-state=audit-long]", device: MOBILE },
    { name: "gate-audit-default-mobile", path: KITCHEN_SINK, clip: "[data-state=audit-default]", device: MOBILE },
  ],
  forms: [
    { name: "forms-desktop", path: FORMS_KITCHEN_SINK },
    { name: "forms-mobile", path: FORMS_KITCHEN_SINK, device: MOBILE },
    { name: "forms-focus-field", path: FORMS_KITCHEN_SINK, focus: "emailField" },
    { name: "forms-focus-toggle", path: FORMS_KITCHEN_SINK, focus: "passwordToggle" },
    { name: "forms-focus-button", path: FORMS_KITCHEN_SINK, focus: "submitButton" },
    { name: "forms-focus-field-error", path: FORMS_KITCHEN_SINK, focus: "erroredField" },
    {
      name: "forms-hover-button",
      path: FORMS_KITCHEN_SINK,
      hover: "[data-state=default] [data-form=signin] button[type=submit]",
    },
    { name: "forms-focus-note-field", path: FORMS_KITCHEN_SINK, focus: "noteField" },
    {
      name: "forms-hover-note-submit",
      path: FORMS_KITCHEN_SINK,
      hover: "[data-state=default] [data-form=note] button[type=submit]",
    },
    { name: "forms-focus-limits-field", path: FORMS_KITCHEN_SINK, focus: "limitsField" },
    {
      name: "forms-hover-requirements-submit",
      path: FORMS_KITCHEN_SINK,
      hover: "[data-state=default] [data-form=requirements] button[type=submit]",
    },
    // The audit settings form: its „Model" list focused and hovered, and its submit button hovered.
    // Its disabled and loading renders are in the full-page shots above.
    { name: "forms-focus-audit-select", path: FORMS_KITCHEN_SINK, focus: "auditSelect" },
    {
      name: "forms-hover-audit-select",
      path: FORMS_KITCHEN_SINK,
      hover: "[data-state=default] [data-form=audit] button[role=combobox]",
    },
    {
      name: "forms-hover-audit-submit",
      path: FORMS_KITCHEN_SINK,
      hover: "[data-state=default] [data-form=audit] button[type=submit]",
    },
  ],
  board: [
    { name: "board-desktop", path: BOARD_KITCHEN_SINK },
    { name: "board-mobile", path: BOARD_KITCHEN_SINK, device: MOBILE },
    { name: "board-focus-row", path: BOARD_KITCHEN_SINK, focus: "boardRow" },
    { name: "board-focus-sort", path: BOARD_KITCHEN_SINK, focus: "boardSort" },
    { name: "board-hover-row", path: BOARD_KITCHEN_SINK, hover: "[data-state=default] a[href^='/offers/']" },
    { name: "board-breaches", path: BOARD_KITCHEN_SINK, clip: "[data-state=breaches]" },
    { name: "board-limits-error", path: BOARD_KITCHEN_SINK, clip: "[data-state=limits-error]" },
    {
      name: "board-hover-breach-row",
      path: BOARD_KITCHEN_SINK,
      hover: "[data-state=breaches] a[href^='/offers/']",
    },
    // The audit status badge: „Audytowano" beside „Nie audytowano", and a failed read of the
    // audits, where every row says its status could not be checked. The second also at 375 px,
    // where the longest label has to wrap.
    { name: "board-audits", path: BOARD_KITCHEN_SINK, clip: "[data-state=audits]" },
    { name: "board-audits-error", path: BOARD_KITCHEN_SINK, clip: "[data-state=audits-error]" },
    { name: "board-audits-error-mobile", path: BOARD_KITCHEN_SINK, clip: "[data-state=audits-error]", device: MOBILE },
  ],
  criteria: [
    { name: "criteria-desktop", path: CRITERIA_KITCHEN_SINK },
    { name: "criteria-mobile", path: CRITERIA_KITCHEN_SINK, device: MOBILE },
    { name: "criteria-focus-city", path: CRITERIA_KITCHEN_SINK, focus: "criteriaCity" },
    { name: "criteria-focus-requirements-edit", path: CRITERIA_KITCHEN_SINK, focus: "requirementsEdit" },
    {
      name: "criteria-hover-limits-submit",
      path: CRITERIA_KITCHEN_SINK,
      hover: "[data-state=full] [data-criteria-section=limits] button[type=submit]",
    },
    // The audit settings section on its own: current values with their signature, never changed
    // (no signature), a failed save above the form, and a failed read with no form.
    {
      name: "criteria-audit-default",
      path: CRITERIA_KITCHEN_SINK,
      clip: "[data-state=full] [data-criteria-section=audit]",
    },
    {
      name: "criteria-audit-unsigned",
      path: CRITERIA_KITCHEN_SINK,
      clip: "[data-state=empty] [data-criteria-section=audit]",
    },
    {
      name: "criteria-audit-error",
      path: CRITERIA_KITCHEN_SINK,
      clip: "[data-state=audit-error] [data-criteria-section=audit]",
    },
    {
      name: "criteria-audit-read-error",
      path: CRITERIA_KITCHEN_SINK,
      clip: "[data-state=audit-read-error] [data-criteria-section=audit]",
    },
    { name: "criteria-focus-audit-model", path: CRITERIA_KITCHEN_SINK, focus: "criteriaAuditModel" },
    {
      name: "criteria-hover-audit-submit",
      path: CRITERIA_KITCHEN_SINK,
      hover: "[data-state=full] [data-criteria-section=audit] button[type=submit]",
    },
  ],
  errors: [
    { name: "errors-desktop", path: ERRORS_KITCHEN_SINK },
    { name: "errors-mobile", path: ERRORS_KITCHEN_SINK, device: MOBILE },
    { name: "errors-focus-retry", path: ERRORS_KITCHEN_SINK, focus: "errorsRetry" },
    // The retry link is the first link of the 503 view; on /dev/errors it leads to /dashboard.
    { name: "errors-hover-retry", path: ERRORS_KITCHEN_SINK, hover: "[data-state='503'] [data-error-page] a" },
  ],
  views: [
    { name: "views-signin", path: "/auth/signin", auth: false },
    {
      name: "views-signin-error",
      path: "/auth/signin?error=Nieprawid%C5%82owy%20e-mail%20lub%20has%C5%82o.",
      auth: false,
    },
    { name: "views-signin-mobile", path: "/auth/signin", auth: false, device: MOBILE },
    { name: "views-home", path: "/", auth: false },
    { name: "views-dashboard", path: "/dashboard" },
    {
      name: "views-dashboard-error",
      path: "/dashboard?error=Vetpad%20obs%C5%82uguje%20wy%C5%82%C4%85cznie%20og%C5%82oszenia%20z%20otodom.pl.",
    },
  ],
};

const USAGE = `Usage: node scripts/ui-screenshots.mjs <set> <outDir>

Sets:
  before  signin (signed out), home, dashboard, the real offer card
  p2      signin, home, dashboard after the token phase
  p3      the real offer card (full page and ?duplicate=1 banner), home
  gate    ${KITCHEN_SINK}: desktop, mobile 375 px, focus on the Topbar link,
          the external link, a gallery thumbnail, a banner link and the own
          note's „Edytuj" button, and a forced :hover on that button; the
          audit section on its own in every state of its matrix (a result,
          no audit, empty categories, no provider key, an attempt in
          progress, a failed and an interrupted attempt, a failed read, an
          answer that is not the audit's stream, an audit in progress, long
          content - also at 375 px), with focus and a forced :hover on
          „Uruchom audyt AI"
  forms   ${FORMS_KITCHEN_SINK}: desktop, mobile 375 px, focus on the email field,
          the password toggle, the submit button, the errored field, the
          note's first field, the limits' city field and the audit settings'
          „Model" list, and a forced :hover on the sign-in, the note, the
          requirements and the audit settings submit buttons and on that list
  board   ${BOARD_KITCHEN_SINK}: desktop, mobile 375 px, focus on the first offer row and
          the first sort link, a forced :hover on the first offer row and on
          a row outside the team's limits, and the sections with limit
          breaches, with a failed limits read, with the audit status badges
          and with a failed read of the audits on their own
  criteria ${CRITERIA_KITCHEN_SINK}: desktop, mobile 375 px, focus on the city field,
          on the own requirements' „Edytuj" and on the audit settings'
          „Model" list, a forced :hover on „Zapisz limity" and on „Zapisz
          ustawienia", and the audit settings section on its own: signed,
          never changed, with a failed save and with a failed read
  errors  ${ERRORS_KITCHEN_SINK}: the 500 and 503 pages' views, desktop, mobile 375 px,
          focus on „Spróbuj ponownie" and a forced :hover on it
  views   signin, signin with an error, signin mobile 375 px, home (signed out),
          dashboard, dashboard with a server error

outDir is required: the change folder's screenshots directory, e.g.
context/changes/<change-id>/screenshots. Files named *offer-real* show a
third-party listing and are git-ignored.
Env: BASE_URL, OFFER_ID, CHROME, SMOKE_EMAIL, SMOKE_PASSWORD.
Exit codes: 0 every shot saved, 1 a shot failed, 2 usage or setup error.`;

const [setName, outArg] = process.argv.slice(2);
const shots = SETS[setName];
// No default directory: a default names one change, and every later change would write into it.
if (shots === undefined || outArg === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const outDir = path.resolve(outArg);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signIn() {
  const response = await fetch(`${BASE_URL}/api/auth/signin`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: BASE_URL, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }).toString(),
  });
  if (response.headers.get("location") !== "/") {
    throw new Error(`sign-in as ${email} failed (${response.status} -> ${response.headers.get("location")})`);
  }
  return response.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(";");
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE_URL };
  });
}

async function launchChrome() {
  const profile = mkdtempSync(path.join(tmpdir(), "ui-screenshots-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      // Tailwind 4 wraps every hover: utility in @media (hover: hover), which headless Chrome (no
      // pointer) never matches, and Emulation.setEmulatedMedia cannot switch it; declare a mouse.
      "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("error", (error) => {
    console.error(`Cannot start ${CHROME}: ${error.message}. Set CHROME=<path to Chrome>.`);
    process.exit(2);
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === "page");
      if (page) return { chrome, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      // Chrome is still starting.
    }
  }
  chrome.kill();
  throw new Error(`Chrome did not open its debugging port ${DEBUG_PORT}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let lastId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method, accept = () => true) =>
    new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === method && accept(message.params)) {
          listeners.delete(listener);
          resolve(message.params);
        }
      };
      listeners.add(listener);
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  return { ws, send, once, evaluate };
}

// Scrolls through the page so every loading="lazy" image starts, waits for images and fonts,
// then returns to the top and removes the Astro dev toolbar so it does not cover the view.
const SETTLE = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
    scrollTo(0, y);
    await pause(120);
  }
  const loaded = [...document.images].map((img) =>
    img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }));
  await Promise.race([Promise.all(loaded), pause(8000)]);
  await document.fonts.ready;
  document.querySelector("astro-dev-toolbar")?.remove();
  scrollTo(0, 0);
  await pause(200);
  return [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length;
})()`;

// Forces `:hover` on the element the selector matches, via the DOM/CSS domains (not a real mouse
// move, which headless Chrome has no pointer for). Mirrors pressTabUntil's failure mode: no match
// throws, same as "no focusable element matched".
async function forceHover(cdp, selector) {
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no element matched hover selector "${selector}"`);
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
  await sleep(200);
}

async function pressTabUntil(cdp, predicate) {
  await cdp.evaluate(`document.activeElement?.blur(); scrollTo(0, 0);`);
  for (let press = 0; press < 300; press++) {
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    }
    const matched = await cdp.evaluate(
      `(() => { const el = document.activeElement; return !!el && el !== document.body && Boolean(${predicate}); })()`,
    );
    if (matched) {
      await cdp.evaluate(`document.activeElement.scrollIntoView({ block: "center" })`);
      await sleep(200);
      return true;
    }
  }
  return false;
}

async function capture(cdp, shot, cookies) {
  await cdp.send("Network.clearBrowserCookies");
  if (shot.auth !== false) {
    for (const cookie of cookies) await cdp.send("Network.setCookie", cookie);
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", shot.device ?? DESKTOP);

  let status = 0;
  const documentResponse = cdp
    .once("Network.responseReceived", (params) => params.type === "Document")
    .then((params) => {
      status = params.response.status;
    });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: BASE_URL + shot.path });
  await Promise.all([loaded, documentResponse]);

  const landedOn = await cdp.evaluate("location.pathname + location.search");
  if (landedOn !== shot.path) throw new Error(`redirected to ${landedOn}`);
  const brokenImages = await cdp.evaluate(SETTLE);

  if (shot.focus !== undefined && !(await pressTabUntil(cdp, FOCUS[shot.focus]))) {
    throw new Error(`no focusable element matched "${shot.focus}"`);
  }
  if (shot.hover !== undefined) {
    await forceHover(cdp, shot.hover);
  }

  const fullPage = shot.viewport !== true && shot.focus === undefined && shot.hover === undefined;
  const params = { format: "png" };
  if (shot.clip !== undefined) {
    // The element's box in page coordinates, captured beyond the viewport like a full page.
    const box = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(shot.clip)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
    })()`);
    if (box === null) throw new Error(`no element matched clip selector "${shot.clip}"`);
    params.captureBeyondViewport = true;
    params.clip = { ...box, scale: 1 };
  } else if (fullPage) {
    const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
  }
  const { data } = await cdp.send("Page.captureScreenshot", params);
  const file = path.join(outDir, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return { file, status, brokenImages };
}

try {
  await fetch(BASE_URL);
} catch {
  console.error(`Nothing answers at ${BASE_URL}. Start the dev server first: npm run dev`);
  process.exit(2);
}

let cookies;
try {
  cookies = shots.some((shot) => shot.auth !== false) ? await signIn() : [];
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const { chrome, profile, wsUrl } = await launchChrome();
let failed = 0;
try {
  const cdp = await connect(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (const shot of shots) {
    try {
      // One retry: the dev server may reload the page while it rebuilds after a code change.
      const { file, status, brokenImages } = await capture(cdp, shot, cookies).catch(async () => {
        await sleep(1500);
        return capture(cdp, shot, cookies);
      });
      const note = brokenImages > 0 ? `  (${brokenImages} image(s) did not load)` : "";
      console.log(`OK    ${shot.name}  ${status} ${shot.path}  -> ${path.relative(process.cwd(), file)}${note}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${shot.name}  ${shot.path}  -> ${error.message}`);
    }
  }
  cdp.ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} shot(s) failed` : `\nAll ${shots.length} shots saved`);
process.exit(failed ? 1 : 0);
