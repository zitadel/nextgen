/**
 * Names of the bundled Liquid templates the `<zitadel-login>` orchestrator
 * registers.
 *
 * This lives in its own module — separate from `liquid.ts` — so the public
 * barrel can re-export `TEMPLATE_NAMES` without dragging LiquidJS' `Liquid`
 * type (and its Node ambient-type requirements) into the published
 * declaration surface. See `liquid.ts` / the orchestrator barrel.
 */
export const TEMPLATE_NAMES = {
  default: "default",
  authForm: "auth-form",
  passkeyUpsell: "passkey-upsell",
  signedIn: "signed-in",
} as const;
