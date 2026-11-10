// Runs inside the eval container. Verifies the scaffolded app itself, not the
// server and not what the agent said: starts the app, drives it in a real
// browser, and reports each check as {name, passed, evidence}, the same shape
// the harness uses for its reads of the live instance.
//
// The checks a stage can name in its `app` field:
//   register-signin        a new user registers, sees the protected page, signs
//                          out (the page is gated again), and signs back in
//   register-has-phone     the registration form asks for a phone number
//   signin-offers-passkey  sign-in offers a passkey to the registered user
//   protected-pages        an existing app: its public page offers sign-in, a
//                          signed-out visitor is stopped at the protected page,
//                          a new user registers and reaches it with the app's
//                          own content intact, then signing out gates it again
//
// `register-signin` stores the user it created in app-user.json so the later
// checks sign in as a real account. Node runs this file as it is, by stripping
// its types, so it uses only syntax that can be erased.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const WORK = process.env.WORK ?? "/work";
const OUT = process.env.OUT ?? "/out";
const PW_DIR = process.env.PW_DIR ?? "/opt/pw";
// A test credential made up for this eval; it only ever exists in the
// throwaway container.
const PASSWORD = "Eval-Sign-In-Pass-42!";
const STEP_MS = 15_000;
const REDIRECT_MS = 5_000;
const APP_READY_MS = 120_000;
const PROBE_MS = 60_000;

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly evidence: string;
}

// The slice of Playwright these checks use; it is installed inside the
// container, not in this package.
interface Locator {
  first(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  innerText(): Promise<string>;
  waitFor(options: {
    readonly state: "visible" | "hidden";
    readonly timeout: number;
  }): Promise<void>;
}

interface Page {
  url(): string;
  goto(url: string, options: { readonly waitUntil: "domcontentloaded" }): Promise<unknown>;
  getByRole(
    role: "button" | "textbox" | "menuitem" | "link",
    options: { readonly name: RegExp },
  ): Locator;
  getByText(text: string | RegExp, options?: { readonly exact?: boolean }): Locator;
  locator(selector: string): Locator;
  screenshot(options: { readonly path: string }): Promise<unknown>;
  waitForURL(
    predicate: (url: URL) => boolean,
    options: { readonly timeout: number },
  ): Promise<void>;
  waitForLoadState(state: "networkidle", options: { readonly timeout: number }): Promise<void>;
}

interface Browser {
  newContext(): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
}

interface Playwright {
  readonly chromium: { launch(): Promise<Browser> };
}

/** What a stage's `app` field names, with the parameters it takes. */
export interface AppCheckSpec {
  readonly check: string;
  readonly [parameter: string]: unknown;
}

type Check = (
  page: Page,
  origin: string,
  stageId: number,
  spec: AppCheckSpec,
) => Promise<ReadonlyArray<CheckResult>>;

const result = (name: string, passed: boolean, evidence: string): CheckResult => ({
  name,
  passed,
  evidence,
});

function appOrigin(): string {
  const file = join(WORK, ".env.local");
  const issuer = existsSync(file)
    ? /^ZITADEL_ISSUER=(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]
    : undefined;
  return issuer === undefined ? "http://localhost:3000" : issuer.trim().replace(/^["']|["']$/g, "");
}

async function isUp(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(PROBE_MS) });
    return response.status < 500;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the app answers, trying again every two seconds until `deadline`. */
async function untilUp(origin: string, deadline: number): Promise<boolean> {
  if (await isUp(origin)) {
    return true;
  }
  if (Date.now() >= deadline) {
    return false;
  }
  await sleep(2_000);
  return untilUp(origin, deadline);
}

/** Use the dev server the agent left running, or start one. */
async function ensureApp(origin: string): Promise<void> {
  if (await isUp(origin)) {
    return;
  }
  const log = openSync(join(OUT, "app-dev-server.log"), "a");
  spawn("npm", ["run", "dev"], {
    cwd: WORK,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: new URL(origin).port || "3000", BROWSER: "none" },
  }).unref();
  if (!(await untilUp(origin, Date.now() + APP_READY_MS))) {
    throw new Error(`the app did not come up at ${origin} within ${APP_READY_MS / 1000}s`);
  }
}

/** Run a shell command to completion without blocking the server, which keeps sending heartbeats meanwhile. */
function shell(command: string, cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, stdio: "ignore" });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}

/** Install Playwright and Chromium once per container, then load it. */
async function loadPlaywright(): Promise<Playwright> {
  if (!existsSync(join(PW_DIR, "node_modules/playwright"))) {
    mkdirSync(PW_DIR, { recursive: true });
    await shell("npm init -y && npm i playwright", PW_DIR);
    await shell("npx playwright install --with-deps chromium", PW_DIR);
  }
  return createRequire(join(PW_DIR, "x.js"))("playwright") as Playwright;
}

const SIGN_OUT = /sign ?out|log ?out/i;
const PRIMARY = /continue|next|register|sign ?up|create|sign ?in|log ?in|submit/i;

async function visible(locator: Locator, timeout = STEP_MS): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Go to a URL and let the page settle. An app that redirects while the page is
 * loading (a protected page sending a visitor to sign in) aborts the navigation
 * Playwright was waiting on; that is the redirect working, not a failure, so
 * carry on from wherever the page landed.
 */
async function navigate(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ERR_ABORTED|interrupted by another navigation/i.test(message)) {
      throw error;
    }
  }
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => undefined);
}

/**
 * A text field by its accessible name. Only real fields: a label pattern also
 * matches buttons and links ("Open user menu"), which `fill` then rejects.
 */
const textbox = (page: Page, name: RegExp): Locator => page.getByRole("textbox", { name });

async function fillIfPresent(page: Page, label: RegExp, value: string): Promise<boolean> {
  const field = textbox(page, label).first();
  if (!(await visible(field, 2_000))) {
    return false;
  }
  await field.fill(value);
  return true;
}

const press = (page: Page): Promise<void> =>
  page.getByRole("button", { name: PRIMARY }).first().click();

async function fillPasswords(page: Page): Promise<boolean> {
  const fields = page.locator('input[type="password"]');
  if (!(await visible(fields))) {
    return false;
  }
  const indexes = Array.from({ length: await fields.count() }, (_, index) => index);
  await Promise.all(indexes.map((index) => fields.nth(index).fill(PASSWORD)));
  return true;
}

async function bodyText(page: Page): Promise<string> {
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  return text.replace(/\s+/g, " ").trim();
}

/** A way to tell that a visitor is signed in, on the page they were sent to. */
type SignedIn = (page: Page) => Promise<boolean>;

const SIGN_OUT_ROLES = ["button", "menuitem", "link"] as const;
const ACCOUNT_MENU = /user|account|profile|menu/i;

/** Every way a sign-out control can be exposed to a visitor right now. */
const signOutControls = (page: Page): ReadonlyArray<Locator> =>
  SIGN_OUT_ROLES.map((role) => page.getByRole(role, { name: SIGN_OUT }));

/**
 * The sign-out control, wherever the app put it: on the page, or in an account
 * menu the signed-in user opens first. A control behind a menu is a valid
 * design, so the menu is opened and looked in once.
 */
async function findSignOut(page: Page): Promise<Locator | undefined> {
  const firstVisible = async (): Promise<Locator | undefined> => {
    for (const control of signOutControls(page)) {
      if (await visible(control, 3_000)) {
        return control;
      }
    }
    return undefined;
  };
  const direct = await firstVisible();
  if (direct !== undefined) {
    return direct;
  }
  const menu = page.getByRole("button", { name: ACCOUNT_MENU });
  if (!(await visible(menu, 2_000))) {
    return undefined;
  }
  await menu.first().click();
  return firstVisible();
}

/** The protected page shows a signed-in session: it offers a sign-out control. */
const signedIn: SignedIn = async (page) => (await findSignOut(page)) !== undefined;

/** The app's own sign-in and sign-up routes, as a whole path segment: /authors is not one. */
const AUTH_PAGE = /^\/(login|register|sign-?in|sign-?up|auth)(\/|$)/i;

/**
 * A signed-out visitor is stopped at the page: sent to an auth page, shown a
 * sign-in form, or, when the page's own content is named, sent somewhere else
 * (an app may send them to its public home page, which offers to sign in); with
 * no sign-out control, and without seeing that content. The absence of a
 * control alone proves nothing.
 */
interface Gate {
  readonly stopped: boolean;
  /** Which of the conditions held, so a failure says what the page actually did. */
  readonly detail: string;
}

async function stoppedAtGate(page: Page, content?: string, requested?: string): Promise<Gate> {
  // A gate is often a redirect the app makes a moment after the page loads, so
  // judge where the visitor ends up, not where they were when it loaded.
  if (requested !== undefined) {
    await page
      .waitForURL((url) => url.pathname !== requested, { timeout: REDIRECT_MS })
      .catch(() => undefined);
  }
  const pathname = new URL(page.url()).pathname;
  const sentElsewhere = content !== undefined && requested !== undefined && pathname !== requested;
  const atAuth =
    AUTH_PAGE.test(pathname) || sentElsewhere || (await visible(textbox(page, /e-?mail/i), 5_000));
  const contentHidden =
    content === undefined || (await page.getByText(content, { exact: true }).count()) === 0;
  const controlGone = (
    await Promise.all(signOutControls(page).map((control) => control.count()))
  ).every((count) => count === 0);
  return {
    stopped: atAuth && contentHidden && controlGone,
    detail: `sent to sign in or away: ${atAuth}; protected content hidden: ${contentHidden}; sign-out control gone: ${controlGone}`,
  };
}

/** Signed in to an existing app: its own protected content shows, and the visitor was not sent to an auth page. */
const reachedContent =
  (content: string): SignedIn =>
  async (page) =>
    !AUTH_PAGE.test(new URL(page.url()).pathname) &&
    (await visible(page.getByText(content, { exact: true }), 10_000));

/** Wait for a submit to finish: the app leaves the auth pages once it is done. */
async function settle(page: Page): Promise<void> {
  await page
    .waitForURL((url) => !/^\/(register|login)(\/|$)/.test(url.pathname), { timeout: STEP_MS * 2 })
    .catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => undefined);
}

async function openProtectedPage(page: Page, origin: string, path = "/profile"): Promise<void> {
  await navigate(page, `${origin}${path}`);
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => undefined);
}

const REGISTERED = "a new user can register in the app";
const PROTECTED = "the registered user reaches the protected page";
const GATED = "signing out gates the protected page again";
const SIGNED_BACK_IN = "the same user can sign in again";
const SIGN_OUT_OFFERED = "the app offers a signed-in user a way to sign out";

const notReached = (names: ReadonlyArray<string>): ReadonlyArray<CheckResult> =>
  names.map((name) => result(name, false, "not reached — an earlier step failed"));

/** Register a new user and look at the protected page; the checks, and whether it was reached. */
async function register(
  page: Page,
  origin: string,
  email: string,
  stageId: number,
  landing = "/profile",
  isSignedIn: SignedIn = signedIn,
): Promise<{ readonly checks: ReadonlyArray<CheckResult>; readonly reached: boolean }> {
  await navigate(page, `${origin}/register`);
  if (!(await visible(textbox(page, /e-?mail/i)))) {
    return {
      reached: false,
      checks: [
        result(
          REGISTERED,
          false,
          `no email field at /register: ${(await bodyText(page)).slice(0, 200)}`,
        ),
      ],
    };
  }
  await fillIfPresent(page, /e-?mail/i, email);
  await fillIfPresent(page, /first|given/i, "Eval");
  await fillIfPresent(page, /last|family|sur/i, "User");
  await fillIfPresent(page, /phone|tel/i, "+15555550100");
  await press(page);
  const sawPassword = await fillPasswords(page);
  if (sawPassword) {
    await press(page);
  }
  await settle(page);
  await page.screenshot({ path: join(OUT, `app-stage${stageId}-after-register.png`) });

  await openProtectedPage(page, origin, landing);
  const profile = await bodyText(page);
  const reached = await isSignedIn(page);
  await page.screenshot({ path: join(OUT, `app-stage${stageId}-profile.png`) });
  return {
    reached,
    checks: [
      result(
        REGISTERED,
        reached || !/\/(login|register)/.test(page.url()),
        `registered ${email}; password step ${sawPassword ? "shown" : "not shown"}; landed on ${page.url()}`,
      ),
      result(
        PROTECTED,
        reached,
        reached
          ? `${landing} shows the signed-in session`
          : `${landing} at ${page.url()}: ${profile.slice(0, 200)}`,
      ),
    ],
  };
}

async function signOut(
  page: Page,
  origin: string,
  path = "/profile",
  content?: string,
  stageId = 0,
): Promise<CheckResult> {
  const control = await findSignOut(page);
  const hadControl = control !== undefined;
  if (control !== undefined) {
    await control.first().click();
    // Let the sign-out finish before leaving the page, or it is cut short.
    await control
      .first()
      .waitFor({ state: "hidden", timeout: STEP_MS })
      .catch(() => undefined);
  }
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => undefined);
  await openProtectedPage(page, origin, path);
  const gate = await stoppedAtGate(page, content, path);
  await page.screenshot({ path: join(OUT, `app-stage${stageId}-after-signout.png`) });
  return result(
    GATED,
    hadControl && gate.stopped,
    hadControl
      ? `after sign-out ${path} is at ${page.url()} (${gate.detail})`
      : "no sign-out control on the protected page",
  );
}

async function signInAs(
  page: Page,
  origin: string,
  email: string,
  path = "/profile",
  isSignedIn: SignedIn = signedIn,
): Promise<CheckResult> {
  await navigate(page, `${origin}/login`);
  await fillIfPresent(page, /e-?mail|user ?name|login/i, email);
  await press(page);
  await fillPasswords(page);
  await press(page);
  await settle(page);
  await openProtectedPage(page, origin, path);
  return result(SIGNED_BACK_IN, await isSignedIn(page), `${path} at ${page.url()}`);
}

const registerAndSignIn: Check = async (page, origin, stageId) => {
  const email = `eval+${Date.now()}@example.com`;
  const registration = await register(page, origin, email, stageId);
  if (!registration.reached) {
    return [
      ...registration.checks,
      ...notReached(
        [PROTECTED, GATED, SIGNED_BACK_IN].filter(
          (name) => !registration.checks.some((check) => check.name === name),
        ),
      ),
    ];
  }
  writeFileSync(join(OUT, "app-user.json"), JSON.stringify({ email, password: PASSWORD }));
  const gated = await signOut(page, origin, "/profile", undefined, stageId);
  const signedBackIn = await signInAs(page, origin, email);
  return [...registration.checks, gated, signedBackIn];
};

const SIGN_IN_LINK = /sign ?in|log ?in/i;

/** Where `spec` names a string parameter, which it must. */
const param = (spec: AppCheckSpec, name: string): string => String(spec[name] ?? "");

const protectedPages: Check = async (page, origin, stageId, spec) => {
  const publicPath = param(spec, "public");
  const protectedPath = param(spec, "protected");
  const marker = param(spec, "marker");
  const email = `eval+${Date.now()}@example.com`;

  await navigate(page, `${origin}${publicPath}`);
  const offersSignIn =
    (await visible(page.getByRole("button", { name: SIGN_IN_LINK }), 10_000)) ||
    (await visible(page.getByRole("link", { name: SIGN_IN_LINK }), 5_000));
  const publicCheck = result(
    "the public page still loads and offers a way to sign in",
    offersSignIn && !AUTH_PAGE.test(new URL(page.url()).pathname),
    `${publicPath} at ${page.url()}${offersSignIn ? "" : ": no sign-in control"}`,
  );

  await openProtectedPage(page, origin, protectedPath);
  const gateBefore = await stoppedAtGate(page, marker, protectedPath);
  const stoppedCheck = result(
    "a signed-out visitor is stopped at the protected page",
    gateBefore.stopped,
    `${protectedPath} at ${page.url()} (${gateBefore.detail})`,
  );

  const others = param(spec, "also")
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path !== "");
  const othersDetail: string[] = [];
  for (const other of others) {
    await openProtectedPage(page, origin, other);
    const gate = await stoppedAtGate(page, undefined, other);
    othersDetail.push(`${other}: ${gate.stopped ? "stopped" : `open (${gate.detail})`}`);
  }
  const othersCheck = result(
    "a signed-out visitor is stopped at the app's other pages too",
    othersDetail.every((line) => line.includes(": stopped")),
    othersDetail.join("; ") || "no other pages named",
  );

  const registration = await register(
    page,
    origin,
    email,
    stageId,
    protectedPath,
    reachedContent(marker),
  );
  if (!registration.reached) {
    return [
      publicCheck,
      stoppedCheck,
      othersCheck,
      ...registration.checks,
      ...notReached(
        [PROTECTED, SIGN_OUT_OFFERED, GATED, SIGNED_BACK_IN].filter(
          (name) => !registration.checks.some((check) => check.name === name),
        ),
      ),
    ];
  }
  const offered = await signedIn(page);
  const offeredCheck = result(
    SIGN_OUT_OFFERED,
    offered,
    offered
      ? `${protectedPath} offers a sign-out control`
      : `${protectedPath} has no sign-out control for a signed-in user`,
  );
  const gated = await signOut(page, origin, protectedPath, marker, stageId);
  const signedBackIn = await signInAs(page, origin, email, protectedPath, reachedContent(marker));
  return [
    publicCheck,
    stoppedCheck,
    othersCheck,
    ...registration.checks,
    offeredCheck,
    gated,
    signedBackIn,
  ];
};

const registerHasPhone: Check = async (page, origin) => {
  await navigate(page, `${origin}/register`);
  await visible(textbox(page, /e-?mail/i));
  const has = (await textbox(page, /phone|tel/i).count()) > 0;
  return [
    result(
      "the registration form asks for a phone number",
      has,
      has
        ? "found a phone field on /register"
        : `no phone field: ${(await bodyText(page)).slice(0, 200)}`,
    ),
  ];
};

const signInOffersPasskey: Check = async (page, origin) => {
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
  const { email } = JSON.parse(readFileSync(userFile, "utf8")) as { readonly email: string };
  await navigate(page, `${origin}/login`);
  await fillIfPresent(page, /e-?mail|user ?name|login/i, email);
  await press(page);
  await page.waitForLoadState("networkidle", { timeout: STEP_MS }).catch(() => undefined);
  const text = await bodyText(page);
  const offers = await visible(page.getByText(/passkey/i), 10_000);
  return [
    result(
      "sign-in offers a passkey",
      offers,
      offers ? "the sign-in step mentions a passkey" : `no passkey option: ${text.slice(0, 200)}`,
    ),
  ];
};

const CHECKS: Readonly<Record<string, Check>> = {
  "register-signin": registerAndSignIn,
  "register-has-phone": registerHasPhone,
  "signin-offers-passkey": signInOffersPasskey,
  "protected-pages": protectedPages,
};

/** Open a browser for `use` and close it afterwards, whether `use` finished or threw. */
async function withBrowser<T>(use: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await (await loadPlaywright()).chromium.launch();
  try {
    return await use(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Run one named check. It never throws: a crash becomes a failed check. */
export async function runAppCheck(
  requested: string | AppCheckSpec,
  stageId: number,
): Promise<ReadonlyArray<CheckResult>> {
  const spec: AppCheckSpec = typeof requested === "string" ? { check: requested } : requested;
  const check = spec.check;
  const run = CHECKS[check];
  if (run === undefined) {
    return [result(`app check "${check}"`, false, "unknown app check")];
  }
  const origin = appOrigin();
  try {
    await ensureApp(origin);
    return await withBrowser(async (browser) =>
      run(await (await browser.newContext()).newPage(), origin, stageId, spec),
    );
  } catch (error) {
    appendFileSync(join(OUT, `app-stage${stageId}.log`), `${describe(error)}\n`);
    return [result(`app check "${check}"`, false, describe(error).slice(0, 300))];
  }
}
