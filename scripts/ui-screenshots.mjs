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

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };

// Focus targets for the gate, reached with real Tab presses so :focus-visible applies.
// The card links are matched inside a shadcn Card, so a banner link above it is skipped.
const FOCUS = {
  topbar: `el.getAttribute("href") === "/dashboard"`,
  external: `el.matches("[data-slot=card] a[target=_blank]") && !el.querySelector("img")`,
  thumb: `el.matches("[data-slot=card] a") && el.querySelector("img") !== null`,
  banner: `el.matches(".banner a")`,
};

// A shot is a full page unless `viewport` or `focus` says otherwise; `auth: false` drops the session.
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
  gate    ${KITCHEN_SINK}: desktop, mobile 375 px, and focus on the Topbar link,
          the external link, a gallery thumbnail and a banner link
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

  const fullPage = shot.viewport !== true && shot.focus === undefined;
  const params = { format: "png" };
  if (fullPage) {
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
