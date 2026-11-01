import { type SignupAttribution, campaignValue } from "./contract";

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
