import { type SignupAttribution, campaignValue } from "@zitadel/cloud-functions/contract";

/**
 * Where a sign-up came from, read from the address alone (root ADR 084 §3):
 * nothing is stored on the device, so no consent is needed, and the source
 * holds only as far as links carry it. `/login` keeps the page it returns to
 * in `next`, with that page's query; `/signup` puts its own query there too.
 */

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

type Campaign = Pick<SignupAttribution, (typeof UTM_KEYS)[number]>;

/** What `signup_completed` carries besides the header (docs/product-analytics-events.yaml). */
export type SignupSource = Campaign & {
  /** The page the account was made on: `signup`, `login` or `claim`. */
  page: string;
  /** The host of the page that linked here, ours included; never its path. */
  referrer_host?: string;
};

/** A path's last segment: `/console/claim` is `claim`. */
function pageOf(url: URL): string {
  return url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

/** The CLI's claim page, the only place the CLI makes an account. */
export function isClaimPage(path: string): boolean {
  return path.split("/").filter(Boolean).at(-1) === "claim";
}

/** The page's campaign parameters or, where it has none, those of the page it returns to. */
function campaignOf(url: URL): Campaign {
  const own = campaignIn(url.searchParams);
  if (Object.keys(own).length > 0) return own;
  const next = url.searchParams.get("next");
  return next?.startsWith("/") ? campaignIn(new URL(next, url.origin).searchParams) : {};
}

function campaignIn(params: URLSearchParams): Campaign {
  const campaign: Campaign = {};
  for (const key of UTM_KEYS) {
    const value = campaignValue(params.get(key));
    if (value) campaign[key] = value;
  }
  return campaign;
}

/**
 * The page to land on after signing up, carrying the campaign parameters of
 * the page the person signs up on, so the landing hands them to onboarding.
 * `next` is router-relative, as the console sanitized it; unset is the home
 * page.
 */
export function nextWithCampaign(next: string | undefined, url: URL): string | undefined {
  const campaign = campaignOf(url);
  if (Object.keys(campaign).length === 0) return next;
  const target = new URL(next ?? "/", url.origin);
  for (const [key, value] of Object.entries(campaign)) target.searchParams.set(key, value);
  return `${target.pathname}${target.search}${target.hash}`;
}

/** What `account/ensure` hands onboarding, from the address the page loaded at. */
export function attributionOf(url: URL): SignupAttribution {
  return { via: isClaimPage(url.pathname) ? "cli" : "console", ...campaignOf(url) };
}

/** What `signup_completed` reports, from the page the account was made on. */
export function signupSourceOf(url: URL, referrer: string): SignupSource {
  const host = URL.canParse(referrer) ? new URL(referrer).host : "";
  return { page: pageOf(url), ...campaignOf(url), ...(host ? { referrer_host: host } : {}) };
}

/**
 * The address this page loaded at, read when the add-on loads: the console's
 * redirects past sign-in drop the query, and the add-on loads before them.
 */
export const landing: SignupAttribution | undefined =
  typeof location === "undefined" ? undefined : attributionOf(new URL(location.href));

/**
 * The platform flow's steps whose submit creates the user: those
 * `packages/config/defaults/default-login.json` gives `on_success:
 * create_user`, which `attribution.spec.ts` checks. The add-on cannot read the
 * file itself, since `@zitadel/config/defaults` reads it with `node:fs`.
 */
export const CREATE_USER_STEPS: ReadonlySet<string> = new Set(["register-password"]);

type StepDetail = { step?: { name?: string; complete?: unknown } };
type CompleteDetail = { waitUntil?: (work: Promise<unknown>) => void };

/**
 * Calls `onSignUp` when a `<zitadel-login>` beneath `target` finishes a flow
 * whose last step before the end created the user: a sign-up, never a
 * sign-in, and not a sign-up that fell back to signing in an address that
 * exists already. The widget waits for what `onSignUp` answers, briefly,
 * before it leaves the page. Answers the function that stops watching.
 */
export function watchSignUps(target: EventTarget, onSignUp: () => Promise<unknown>): () => void {
  const lastStep = new WeakMap<EventTarget, string>();
  const onStep = (event: Event) => {
    const step = (event as CustomEvent<StepDetail>).detail?.step;
    // The end is a step of its own, which comes before the flow says it ended.
    if (event.target && step?.name && !step.complete) lastStep.set(event.target, step.name);
  };
  const onComplete = (event: Event) => {
    if (!event.target || !CREATE_USER_STEPS.has(lastStep.get(event.target) ?? "")) return;
    lastStep.delete(event.target);
    const sent = onSignUp();
    (event as CustomEvent<CompleteDetail>).detail?.waitUntil?.(sent);
  };
  target.addEventListener("zitadel-flow-step", onStep);
  target.addEventListener("zitadel-flow-complete", onComplete);
  return () => {
    target.removeEventListener("zitadel-flow-step", onStep);
    target.removeEventListener("zitadel-flow-complete", onComplete);
  };
}
