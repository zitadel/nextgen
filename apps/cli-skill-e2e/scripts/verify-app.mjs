// Runs inside the eval container. Verifies the scaffolded app itself, not the
// server and not what the agent said: starts the app, drives it in a real
// browser, and reports each check as an assertion result ({name, passed,
// evidence}) so the grader treats it like any live-instance assertion.
//
// The checks a stage can name in its `app` field:
//   register-signin    a new user registers, sees the protected page, signs out
//                      (the page is gated again), and signs back in
//   register-has-phone the registration form asks for a phone number
//   signin-offers-passkey  sign-in offers a passkey to the registered user
//
// `register-signin` stores the user it created in app-user.json so the later
// checks sign in as a real account.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const WORK = process.env.WORK || "/work";
const OUT = process.env.OUT || "/out";
const PW_DIR = process.env.PW_DIR || "/opt/pw";
// A test credential generated for this run; it only ever exists in the
// throwaway container.
const PASSWORD = "Eval-Sign-In-Pass-42!";
const STEP_MS = 15_000;

function appOrigin() {
  const env = join(WORK, ".env.local");
  if (existsSync(env)) {
    const m = /^ZITADEL_ISSUER=(.+)$/m.exec(readFileSync(env, "utf8"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "http://localhost:3000";
}

async function isUp(origin) {
  try {
    const res = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(60_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Use the dev server the agent left running, or start one. */
async function ensureApp(origin) {
  if (await isUp(origin)) return;
  const log = openSync(join(OUT, "app-dev-server.log"), "a");
  const port = new URL(origin).port || "3000";
  const child = spawn("npm", ["run", "dev"], {
    cwd: WORK,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: port, BROWSER: "none" },
  });
  child.unref();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isUp(origin)) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`the app did not come up at ${origin} within 120s`);
}

/** Install Playwright + Chromium once per container, then load it. */
function loadPlaywright() {
  if (!existsSync(join(PW_DIR, "node_modules/playwright"))) {
    mkdirSync(PW_DIR, { recursive: true });
    const sh = (cmd) =>
      spawnSync("bash", ["-lc", cmd], { cwd: PW_DIR, stdio: "ignore", encoding: "utf8" });
    sh("npm init -y && npm i playwright");
    sh("npx playwright install --with-deps chromium");
  }
  return createRequire(join(PW_DIR, "x.js"))("playwright");
}

const SIGN_OUT = /sign ?out|log ?out/i;
const PRIMARY = /continue|next|register|sign ?up|create|sign ?in|log ?in|submit/i;

async function visible(locator, ms = STEP_MS) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function fillIfPresent(page, label, value) {
  const field = page.getByLabel(label).first();
  if (await visible(field, 2_000)) {
    await field.fill(value);
    return true;
  }
  return false;
}

async function press(page) {
  await page.getByRole("button", { name: PRIMARY }).first().click();
}

async function fillPasswords(page) {
  if (!(await visible(page.locator('input[type="password"]')))) return false;
  const fields = page.locator('input[type="password"]');
  for (let i = 0; i < (await fields.count()); i += 1) await fields.nth(i).fill(PASSWORD);
  return true;
}

async function bodyText(page) {
  return (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** The protected page shows a signed-in session: it offers a sign-out control. */
function signedIn(page) {
  return visible(page.getByRole("button", { name: SIGN_OUT }), 10_000);
}

/** Wait for a submit to finish: the app leaves the auth pages once it is done. */
async function settle(page) {
  await page
    .waitForURL((u) => !/^\/(register|login)(\/|$)/.test(u.pathname), { timeout: STEP_MS * 2 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
}

function result(name, passed, evidence) {
  return { name, passed, evidence };
}

async function registerAndSignIn(page, origin, stageId) {
  const results = [];
  const email = `eval+${Date.now()}@example.com`;
  const note = (n, ok, ev) => results.push(result(n, ok, ev));
  const notReached = (names) => {
    for (const n of names) {
      note(n, false, "not reached — an earlier step failed");
    }
  };
  const rest = [
    "the registered user reaches the protected page",
    "signing out gates the protected page again",
    "the same user can sign in again",
  ];

  await page.goto(`${origin}/register`, { waitUntil: "domcontentloaded" });
  const hasEmail = await visible(page.getByLabel(/email/i));
  if (!hasEmail) {
    note(
      "a new user can register in the app",
      false,
      `no email field at /register: ${(await bodyText(page)).slice(0, 200)}`,
    );
    notReached(rest);
    return results;
  }
  await fillIfPresent(page, /e-?mail/i, email);
  await fillIfPresent(page, /first|given/i, "Eval");
  await fillIfPresent(page, /last|family|sur/i, "User");
  await fillIfPresent(page, /phone|tel/i, "+15555550100");
  await press(page);
  const sawPassword = await fillPasswords(page);
  if (sawPassword) await press(page);
  await settle(page);
  await page.screenshot({ path: join(OUT, `app-stage${stageId}-after-register.png`) });

  await page.goto(`${origin}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
  const profile = await bodyText(page);
  const reached = await signedIn(page);
  await page.screenshot({ path: join(OUT, `app-stage${stageId}-profile.png`) });
  note(
    "a new user can register in the app",
    reached || !/\/(login|register)/.test(page.url()),
    `registered ${email}; password step ${sawPassword ? "shown" : "not shown"}; landed on ${page.url()}`,
  );
  note(
    "the registered user reaches the protected page",
    reached,
    reached
      ? "/profile shows the signed-in session"
      : `/profile at ${page.url()}: ${profile.slice(0, 200)}`,
  );
  if (!reached) {
    notReached(rest.slice(1));
    return results;
  }
  writeFileSync(join(OUT, "app-user.json"), JSON.stringify({ email, password: PASSWORD }));

  const signOut = page.getByRole("button", { name: SIGN_OUT });
  const hadSignOut = await visible(signOut, 5_000);
  if (hadSignOut) {
    await signOut.first().click();
    // Let the sign-out finish before leaving the page, or it is cut short.
    await signOut
      .first()
      .waitFor({ state: "hidden", timeout: STEP_MS })
      .catch(() => {});
  }
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
  await page.goto(`${origin}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
  const gated = (await page.getByRole("button", { name: SIGN_OUT }).count()) === 0;
  note(
    "signing out gates the protected page again",
    hadSignOut && gated,
    hadSignOut
      ? `after sign-out /profile is at ${page.url()}`
      : "no sign-out control on the protected page",
  );

  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await fillIfPresent(page, /e-?mail|login|user/i, email);
  await press(page);
  await fillPasswords(page);
  await press(page);
  await settle(page);
  await page.goto(`${origin}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
  const back = await signedIn(page);
  note("the same user can sign in again", back, `/profile at ${page.url()}`);
  return results;
}

async function registerHasPhone(page, origin) {
  await page.goto(`${origin}/register`, { waitUntil: "domcontentloaded" });
  await visible(page.getByLabel(/email/i));
  const phone = page.getByLabel(/phone|tel/i);
  const has = (await phone.count()) > 0;
  return [
    result(
      "the registration form asks for a phone number",
      has,
      has
        ? "found a phone field on /register"
        : `no phone field: ${(await bodyText(page)).slice(0, 200)}`,
    ),
  ];
}

async function signInOffersPasskey(page, origin) {
  const userFile = join(OUT, "app-user.json");
  if (!existsSync(userFile)) {
    return [
      result(
        "sign-in offers a passkey",
        false,
        "no registered user from an earlier stage to sign in as",
      ),
    ];
  }
  const { email } = JSON.parse(readFileSync(userFile, "utf8"));
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await fillIfPresent(page, /e-?mail|login|user/i, email);
  await press(page);
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => {});
  const text = await bodyText(page);
  const offers = await visible(page.getByText(/passkey/i), 10_000);
  return [
    result(
      "sign-in offers a passkey",
      offers,
      offers ? "the sign-in step mentions a passkey" : `no passkey option: ${text.slice(0, 200)}`,
    ),
  ];
}

const CHECKS = {
  "register-signin": registerAndSignIn,
  "register-has-phone": registerHasPhone,
  "signin-offers-passkey": signInOffersPasskey,
};

/** Run one named check; never throws — a crash becomes a failed assertion. */
export async function runAppCheck(check, stageId) {
  const fn = CHECKS[check];
  if (!fn) return [result(`app check "${check}"`, false, "unknown app check")];
  const origin = appOrigin();
  let browser;
  try {
    await ensureApp(origin);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    return await fn(page, origin, stageId);
  } catch (err) {
    appendFileSync(join(OUT, `app-stage${stageId}.log`), `${err?.stack || err}\n`);
    return [result(`app check "${check}"`, false, String(err?.message || err).slice(0, 300))];
  } finally {
    await browser?.close().catch(() => {});
  }
}
