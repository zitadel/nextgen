import { useEffect } from "react";

import type { EnsureAccountResponse } from "@zitadel/cloud-functions/contract";
import type { AddonPage } from "@zitadel/console/addon";

import { cloudSend } from "./cloud-api";
import { VercelInsights } from "./vercel-insights";

/** Asked once per page load: the functions remember the answer, not the browser. */
let ensured: Promise<unknown> | undefined;

/**
 * The cloud's root on every page: Vercel's insights, and, once the person is
 * signed in, the request that provisions their account in Stripe and HubSpot
 * (root ADR 084 §3). It is idempotent and never blocks the console: a failure
 * is asked again on the next page load, and the functions' reconciler catches
 * whoever never comes back.
 */
export function CloudRoot(page: AddonPage) {
  useEffect(() => {
    if (!page.signedIn || ensured) return;
    ensured = cloudSend<EnsureAccountResponse>("POST", "/account/ensure").catch(() => {
      ensured = undefined;
    });
  }, [page.signedIn]);

  return <VercelInsights {...page} />;
}
