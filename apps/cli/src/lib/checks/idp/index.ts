import type { Check } from "../check";
import {
  AuthorizeProbeCheck,
  ClaimsCheck,
  DiscoveryReachableCheck,
  IssuerCheck,
  PkceCheck,
  ScopesCheck,
  SecretProbeCheck,
} from "./checks";
import type { IdpContext, ProviderProbes } from "./context";
import { GOOGLE_PROBES } from "./google";
import { LiveSignInCheck } from "./live";

export {
  idpContext,
  type IdpContext,
  type LiveSignIn,
  type Send,
  type SignInEvent,
  type SignInPhase,
} from "./context";
export { type CheckResult, runChecks } from "../check";

/** Every check a connection goes through, in the order they are shown. */
export const IDP_CHECKS: readonly Check<IdpContext>[] = [
  new DiscoveryReachableCheck(),
  new IssuerCheck(),
  new ScopesCheck(),
  new ClaimsCheck(),
  new PkceCheck(),
  new AuthorizeProbeCheck(),
  new SecretProbeCheck(),
  new LiveSignInCheck(),
];

/** The providers whose wording of a refusal is known, by connection slug. */
export const PROVIDER_PROBES: Readonly<Record<string, ProviderProbes>> = { google: GOOGLE_PROBES };
