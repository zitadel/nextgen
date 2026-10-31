import { mockSystems } from "./mock";
import type { Billing, Crm, Directory, Systems } from "./ports";

/** Production asked for a system that only exists as a mock so far. */
export class NotLiveError extends Error {
  constructor() {
    super("The cloud's functions only answer from mocks so far (root ADR 084 §9).");
    this.name = "NotLiveError";
  }
}

let systems: Systems | undefined;
let onboarding: Onboarding | undefined;

/**
 * The systems this deployment talks to (root ADR 084 §2). Only the mocks
 * exist yet; the live adapters replace them system by system. Production
 * refuses to answer from them, since billing no one and dropping tickets
 * would look like it worked.
 */
export function currentSystems(): Systems {
  if (process.env.VERCEL_ENV === "production") throw new NotLiveError();
  systems ??= mockSystems();
  return systems;
}

/** What onboarding writes: the person's contact, subscriptions and deals, and Stripe customers. */
export interface Onboarding {
  stripe: Pick<Billing, "hasCustomer" | "ensureCustomer">;
  hubspot: Pick<Crm, "upsertContact" | "subscribe" | "ensureDeal">;
}

/**
 * What onboarding's workflows write to (root ADR 084 §3, §9). Production takes
 * the recorders of `src/mock.ts` too, which send nothing to HubSpot or
 * Stripe: sign-up has no call to action yet, so its runs show what onboarding
 * will write while no third party sees it. The live adapters replace them in
 * production only.
 */
export function onboardingSystems(): Onboarding {
  if (process.env.VERCEL_ENV !== "production") return currentSystems();
  onboarding ??= mockSystems();
  return onboarding;
}

/**
 * What the console's RPC answers from: Zitadel read live as the caller,
 * usage included (`GET /usage`, root ADR 086), the rest as `currentSystems()`
 * has them. Production, with no live Stripe or HubSpot yet, refuses those
 * call by call rather than the whole RPC, so `account/ensure` starts
 * onboarding while billing and support answer `cloud.not_live`.
 */
export function rpcSystems(zitadel: Directory): Systems {
  if (process.env.VERCEL_ENV === "production") {
    return { zitadel, stripe: notLive<Billing>(), hubspot: notLive<Crm>() };
  }
  return { ...currentSystems(), zitadel };
}

/** A system whose every call refuses, as `currentSystems()` does in production. */
function notLive<T extends object>(): T {
  return new Proxy({} as T, {
    // `then` stays unset, so the system is never taken for a promise.
    get: (_, name) =>
      name === "then"
        ? undefined
        : async () => {
            throw new NotLiveError();
          },
  });
}
