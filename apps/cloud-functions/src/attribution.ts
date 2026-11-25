import { type SignupAttribution, campaignValue } from "./contract";
import type { Team } from "./ports";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/**
 * The attribution an `account/ensure` body carries, as far as it holds up:
 * the browser sends it, so it is checked here and whatever fails is left out.
 * A body without a known `via` carries none, and none never fails the call
 * (root ADR 084 §3).
 */
export function signupAttribution(body: unknown): SignupAttribution | undefined {
  const raw = (body as { attribution?: unknown } | undefined)?.attribution;
  if (!raw || typeof raw !== "object") return undefined;
  const fields = raw as Record<string, unknown>;
  if (fields.via !== "cli" && fields.via !== "console") return undefined;
  const attribution: SignupAttribution = { via: fields.via };
  for (const key of UTM_KEYS) {
    const value = campaignValue(fields[key]);
    if (value) attribution[key] = value;
  }
  return attribution;
}

/** How long after a person's first session `ensure` still takes them for someone signing up. */
export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

/** How far Zitadel's clock may run ahead of the functions' before a join time is taken for bad data. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Whether the person made their account just now. Zitadel makes the personal
 * team on their first session, so joining it is when they signed up. Anyone
 * older is signing in again: the page they came back through says nothing
 * about how they first found Zitadel, and would stamp a sign-up source on a
 * contact made from a form or the CRM's own adoption of them.
 */
export function signedUpJustNow(teams: Team[], now: number): boolean {
  const personal = teams.find((team) => team.personal);
  if (!personal) return false;
  const age = now - Date.parse(personal.joined_at);
  return age > -CLOCK_SKEW_MS && age < SIGNUP_WINDOW_MS;
}
