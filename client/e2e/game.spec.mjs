#!/usr/bin/env node
/**
 * Godot host-page smoke test (docs/godot-v2-design.md §12 step 7).
 *
 *   node client/e2e/game.spec.mjs <baseUrl> <screenshot.png>
 *
 * Serve client/dist first (`npx vite preview --port 4173` or
 * `python3 -m http.server`). Uses the sandbox Playwright (PW_CORE env or the
 * scratchpad install) with headless Chromium + SwiftShader WebGL2, so it runs
 * without a GPU. Exit code 1 with a clear message on any failure.
 *
 * Runs:
 *   A  mocked window.mb (logged in): ready ≤ 60 s, loader hidden, no
 *      console.error, ≥2 apiState invokes with ok:true, Mine-all click →
 *      apiSetTeamMode once, screenshot + pending-pill pixel check.
 *   B  ?mock=1: ready fires, no apiState invokes, canvas animates (bombs).
 *   C  sessionJson loggedIn:false → connect overlay visible.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const PW_CORE =
  process.env.PW_CORE ??
  "/tmp/claude-0/-home-user-BombCrypto/3c4a6524-213e-54be-80bb-5759114385e3/scratchpad/shot/node_modules/playwright-core";
const CHROMIUM = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const READY_TIMEOUT_MS = 60_000;

const [baseArg, shotArg] = process.argv.slice(2);
if (!baseArg || !shotArg) fail("usage: game.spec.mjs <baseUrl> <screenshot.png>");
const BASE = baseArg.replace(/\/$/, "");
const SHOT = path.resolve(shotArg);
const SHOT_MOCK = SHOT.replace(/(\.png)?$/i, "-mock.png");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// fixture: what the fake apiState returns (40 blocks, row-major 8×5; 3 heroes)
// ---------------------------------------------------------------------------
const FIXTURE = {
  pendingBlast: "12345",
  mapsCleared: 2,
  chainSync: true,
  claimRules: { minBlast: 30000, cooldownHours: 24 },
  adventure: {
    attemptsToday: 1,
    stages: [
      { id: 1, name: "Shallow Cave", staminaCost: 10, minRarity: 0, rewardBlast: "500" },
      { id: 2, name: "Deep Cave", staminaCost: 20, minRarity: 2, rewardBlast: "2000" },
      { id: 3, name: "Lava Core", staminaCost: 30, minRarity: 4, rewardBlast: "8000" },
    ],
  },
  blocks: Array.from({ length: 40 }, (_, i) => {
    const maxHp = 30 + (i % 4) * 20;
    return (i * 7 + 3) % 5 === 0 ? { hp: 0, maxHp } : { hp: Math.max(1, maxHp - (i * 13) % maxHp), maxHp };
  }),
  houses: [{ id: "h1", rarity: 1, capacity: 2, regenBoostBps: 1500, occupants: 1 }],
  heroes: [
    { id: "101", rarity: 0, power: 3, speed: 2, stamina: 40, staminaMax: 50, mode: "work", houseId: "h1", bombIntervalMs: 900 },
    { id: "102", rarity: 2, power: 8, speed: 3, stamina: 20, staminaMax: 60, mode: "rest", houseId: null, bombIntervalMs: 800 },
    { id: "103", rarity: 4, power: 20, speed: 5, stamina: 0, staminaMax: 80, mode: "rest", houseId: null, bombIntervalMs: 600 },
  ],
};

/**
 * Injected before any page script. `__mbTestOverrides` supplies the fakes
 * that game.ts merges over the bridge; the accessor on `window.mb` catches
 * the bridge object at install time so `ready()` and `invoke()` can be
 * recorded while still calling the real implementation.
 */
function initScript({ fixture, loggedIn }) {
  window.__mbCalls = { ready: 0, invokes: [], results: [] };
  window.__mbTestOverrides = {
    apiState: async () => fixture,
    apiSetTeamMode: async () => ({ ...fixture, changed: 2 }),
    // GameState also polls the daily streak and the host calls reconnect():
    // fake both so no request ever reaches the (absent) game server
    apiDailyStatus: async () => ({ claimedToday: false, streak: 0, nextDay: 1, hasHero: true, canClaim: true,
      rewards: [2000, 3000, 4000, 6000, 8000, 12000, 20000], jackpotChance: 25, jackpotBlast: 40000 }),
    reconnect: async () => ({
      walletAddress: loggedIn ? "0x1111111111111111111111111111111111111111" : null,
      tokenAddress: loggedIn ? "0x1111111111111111111111111111111111111111" : null,
      loggedIn, mismatch: false,
    }),
    sessionJson: () =>
      JSON.stringify({
        hasToken: loggedIn,
        tokenAddress: loggedIn ? "0x1111111111111111111111111111111111111111" : null,
        walletAddress: loggedIn ? "0x1111111111111111111111111111111111111111" : null,
        walletKind: loggedIn ? "injected" : null,
        loggedIn,
      }),
  };
  let stored;
  Object.defineProperty(window, "mb", {
    configurable: true,
    enumerable: true,
    get: () => stored,
    set(v) {
      const origReady = v.ready;
      const origInvoke = v.invoke;
      v.ready = function () {
        window.__mbCalls.ready++;
        return origReady.call(v);
      };
      v.invoke = function (reqId, method, argsJson, cb) {
        window.__mbCalls.invokes.push({ method, args: argsJson, t: performance.now() });
        return origInvoke.call(v, reqId, method, argsJson, (id, env) => {
          let parsed;
          try { parsed = JSON.parse(env); } catch { parsed = { ok: false, error: "unparseable envelope" }; }
          window.__mbCalls.results.push({ method, ok: parsed.ok === true, env: parsed });
          cb(id, env);
        });
      };
      stored = v;
    },
  });
}

// ---------------------------------------------------------------------------
// minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what Chromium emits)
// ---------------------------------------------------------------------------
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} unsupported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG color type ${colorType} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let ip = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      let v = raw[ip++];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      out[row + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}
const px = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function newPage(browser, { loggedIn }) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.addInitScript(initScript, { fixture: FIXTURE, loggedIn });
  return { page, context, errors };
}

async function waitForReady(page, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    const calls = await page.evaluate(() => window.__mbCalls);
    if (calls.ready >= 1) return Date.now() - t0;
    const text = await page.locator("#loader-text").textContent().catch(() => "");
    if (/not deployed|cannot run|failed|exited/.test(text ?? "")) fail(`${label}: loader reports "${text}"`);
    await sleep(250);
  }
  const text = await page.locator("#loader-text").textContent().catch(() => "");
  fail(`${label}: mb.ready() not called within ${READY_TIMEOUT_MS / 1000} s (loader: "${text}")`);
}

async function canvasRect(page) {
  return page.evaluate(() => {
    const r = document.getElementById("godot-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
// 960×540 Godot design coordinates → page pixels
const toPage = (rect, x, y) => ({ x: rect.x + (rect.w * x) / 960, y: rect.y + (rect.h * y) / 540 });

async function canvasShot(page, filePath) {
  const rect = await canvasRect(page);
  const buf = await page.screenshot({ path: filePath, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
  return decodePng(buf);
}

// ---------------------------------------------------------------------------
async function main() {
  // (pre) a page with no build would just say "not deployed yet" — that must
  // be a hard failure here, not a silent skip
  // (SPA servers such as `vite preview` answer 404s with index.html and a
  // 200, so "missing" also covers a body that is not a manifest)
  const m = await fetch(`${BASE}/godot/manifest.json`, { cache: "no-store" }).catch(() => null);
  let manifest = null;
  if (m && m.ok) manifest = await m.json().catch(() => null);
  assert(
    manifest && typeof manifest.engine === "string" && typeof manifest.pck === "string",
    `manifest missing: ${BASE}/godot/manifest.json → ${m ? `${m.status} ${manifest ? "without engine/pck" : "non-JSON body"}` : "unreachable"}`
  );
  console.log(`manifest ok: engine=${manifest.engine} pck=${manifest.pck} gitSha=${manifest.gitSha ?? "?"}`);
  assert(existsSync(PW_CORE), `playwright-core not found at ${PW_CORE} (set PW_CORE)`);
  assert(existsSync(CHROMIUM), `chromium not found at ${CHROMIUM} (set PW_CHROMIUM)`);

  const { chromium } = require(PW_CORE);
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });

  try {
    // ---------------- run A: mocked bridge, logged in ----------------
    {
      const { page, context, errors } = await newPage(browser, { loggedIn: true });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const readyMs = await waitForReady(page, "A");
      console.log(`A: ready() after ${readyMs} ms`);

      assert(await page.locator("#loader").isHidden(), "A: #loader still visible after ready()");
      assert(await page.locator("#connect-overlay").isHidden(), "A: connect overlay shown although loggedIn:true");

      // (c) 2 s poll cadence → at least two apiState calls inside 6 s
      const tPoll = Date.now();
      let calls;
      while (Date.now() - tPoll < 6000) {
        calls = await page.evaluate(() => window.__mbCalls);
        if (calls.invokes.filter((i) => i.method === "apiState").length >= 2) break;
        await sleep(200);
      }
      const stateCalls = calls.invokes.filter((i) => i.method === "apiState").length;
      assert(stateCalls >= 2, `A: expected ≥2 apiState invocations within 6 s, got ${stateCalls}`);
      // callbacks must have fired (asynchronously) with ok:true envelopes
      await sleep(300);
      calls = await page.evaluate(() => window.__mbCalls);
      const stateResults = calls.results.filter((r) => r.method === "apiState");
      assert(stateResults.length >= 2, `A: apiState callbacks fired ${stateResults.length} times for ${stateCalls} invokes`);
      const bad = stateResults.find((r) => !r.ok);
      assert(!bad, `A: apiState callback not ok: ${JSON.stringify(bad?.env ?? bad ?? null).slice(0, 300)}\n  all results: ${JSON.stringify(calls.results.map((r) => [r.method, r.ok, r.env?.code ?? "", (r.env?.error ?? "").slice(0, 80)]))}`);
      console.log(`A: ${stateCalls} apiState invokes, ${stateResults.length} ok callbacks`);

      // (d) Mine-all button centre (80,452) in the 960×540 layout
      const rect = await canvasRect(page);
      const p = toPage(rect, 80, 452);
      await page.mouse.click(p.x, p.y);
      const tClick = Date.now();
      let teamCalls = 0;
      while (Date.now() - tClick < 4000) {
        calls = await page.evaluate(() => window.__mbCalls);
        teamCalls = calls.invokes.filter((i) => i.method === "apiSetTeamMode").length;
        if (teamCalls >= 1) break;
        await sleep(150);
      }
      assert(teamCalls === 1, `A: expected apiSetTeamMode called once after clicking Mine-all, got ${teamCalls}`);
      const teamArgs = JSON.parse(calls.invokes.find((i) => i.method === "apiSetTeamMode").args || "{}");
      assert(teamArgs.mode === "work", `A: apiSetTeamMode args ${JSON.stringify(teamArgs)}, expected {mode:"work"}`);
      await sleep(400);
      calls = await page.evaluate(() => window.__mbCalls);
      const teamResult = calls.results.find((r) => r.method === "apiSetTeamMode");
      assert(teamResult && teamResult.ok, "A: apiSetTeamMode callback missing or not ok");
      console.log("A: Mine-all → apiSetTeamMode({mode:'work'}) ok");

      // (e) screenshot + pending plate region (top bar, 168..444 x 9..47) must not be flat background
      await page.screenshot({ path: SHOT, fullPage: false });
      const img = await canvasShot(page, SHOT.replace(/(\.png)?$/i, "-canvas.png"));
      const sx = (x) => Math.round((x / 960) * img.width);
      const sy = (y) => Math.round((y / 540) * img.height);
      let nonBg = 0, total = 0;
      for (let y = sy(12); y < sy(44); y++) {
        for (let x = sx(176); x < sx(440); x++) {
          const [r, g, b] = px(img, x, y);
          total++;
          if (Math.abs(r - 16) + Math.abs(g - 20) + Math.abs(b - 31) > 40) nonBg++;
        }
      }
      assert(total > 0 && nonBg / total > 0.05, `A: pending plate region looks like flat background (${nonBg}/${total} px differ)`);
      console.log(`A: pending plate region ${nonBg}/${total} non-background px; screenshot ${SHOT}`);

      assert(errors.length === 0, `A: console errors:\n  ${errors.join("\n  ")}`);
      await context.close();
    }

    // ---------------- run B: ?mock=1 (MockBackend, no bridge calls) ----------------
    {
      const { page, context, errors } = await newPage(browser, { loggedIn: true });
      await page.goto(`${BASE}/?mock=1`, { waitUntil: "domcontentloaded" });
      const readyMs = await waitForReady(page, "B");
      console.log(`B: ready() after ${readyMs} ms`);
      assert(await page.locator("#loader").isHidden(), "B: #loader still visible after ready()");

      const mockFlag = await page.evaluate(() => JSON.parse(window.mb.configJson()).mock);
      assert(mockFlag === true, "B: configJson().mock is not true with ?mock=1");

      const first = await canvasShot(page, SHOT_MOCK.replace(/\.png$/i, "-t0.png"));
      await sleep(6000);
      const second = await canvasShot(page, SHOT_MOCK);
      assert(first.width === second.width && first.height === second.height, "B: canvas size changed between frames");
      let diff = 0;
      for (let y = 0; y < first.height; y++) {
        for (let x = 0; x < first.width; x++) {
          const a = px(first, x, y), b = px(second, x, y);
          if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 60) diff++;
        }
      }
      assert(diff > 200, `B: canvas barely changed over 6 s (${diff} px) — no bombs/animation in mock mode?`);
      console.log(`B: ${diff} px changed over 6 s; screenshot ${SHOT_MOCK}`);

      const calls = await page.evaluate(() => window.__mbCalls);
      const stateCalls = calls.invokes.filter((i) => i.method === "apiState").length;
      assert(stateCalls === 0, `B: MockBackend must not call apiState, got ${stateCalls}`);
      assert(errors.length === 0, `B: console errors:\n  ${errors.join("\n  ")}`);
      await context.close();
    }

    // ---------------- run C: not logged in → overlay ----------------
    {
      const { page, context } = await newPage(browser, { loggedIn: false });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const readyMs = await waitForReady(page, "C");
      console.log(`C: ready() after ${readyMs} ms`);
      assert(await page.locator("#loader").isHidden(), "C: #loader still visible after ready()");
      assert(await page.locator("#connect-overlay").isVisible(), "C: connect overlay hidden although loggedIn:false");
      assert(await page.locator('#connect-overlay button[data-kind="injected"]').isVisible(), "C: Browser Wallet button missing");
      const calls = await page.evaluate(() => window.__mbCalls);
      const stateCalls = calls.invokes.filter((i) => i.method === "apiState").length;
      assert(stateCalls === 0, `C: logged-out client must not poll apiState, got ${stateCalls}`);
      console.log("C: overlay visible when logged out");
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log("PASS");
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
