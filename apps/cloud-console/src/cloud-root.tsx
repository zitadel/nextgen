import { useEffect } from "react";

import type {
  EnsureAccountRequest,
  EnsureAccountResponse,
} from "@zitadel/cloud-functions/contract";
import type { AddonPage } from "@zitadel/console/addon";

import { track } from "./analytics";
import { isClaimPage, landing, signupSourceOf, watchSignUps } from "./attribution";
import { cloudSend } from "./cloud-api";
import { VercelInsights } from "./vercel-insights";

/** Asked once per page load: the functions remember the answer, not the browser. */
let ensured: Promise<unknown> | undefined;

/**
 * How long a finished sign-up holds the page for its event: Vercel's script
 * sends it, and nothing tells when it has left.
 */
const SEND_MS = 300;

/**
 * The cloud's root on every page: Vercel's insights; `signup_completed` when
 * the sign-in widget makes an account, with where its page says the person
 * came from; and, once the person is signed in, the request that provisions
 * their account in Stripe and HubSpot with that source (root ADR 084 §3). The
 * CLI's claim page asks too: it is where the CLI's sign-ups land signed in,
 * outside the signed-in shell, and it answers 401 before. The request is
 * idempotent and never blocks the console: a failure is asked again on the
 * next page load, and the functions' reconciler catches whoever never comes
 * back.
 */
export function CloudRoot(page: AddonPage) {
  const claim = isClaimPage(page.path);

  useEffect(() => {
    if (!(page.signedIn || claim) || ensured) return;
    const body: EnsureAccountRequest = landing ? { attribution: landing } : {};
    ensured = cloudSend<EnsureAccountResponse>("POST", "/account/ensure", body).catch(() => {
      ensured = undefined;
    });
  }, [page.signedIn, claim]);

  useEffect(
    () =>
      watchSignUps(document, () => {
        track("signup_completed", signupSourceOf(new URL(window.location.href), document.referrer));
        return new Promise((resolve) => setTimeout(resolve, SEND_MS));
      }),
    [],
  );

  return <VercelInsights {...page} />;
}
