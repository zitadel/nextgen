/**
 * Module-level passkey overlay applied by the mock handlers.
 *
 * The shipped login flow (`packages/config/defaults/default-login.json`) does
 * not offer a passkey action on the identifier step — it arrives only when a
 * project enables passkeys — so the fixtures here mirror that and offer none by
 * default. Tests and the dev playground opt in with `applyPasskey(true)`, which
 * adds a `passkey` action to the steps a passkey sign-in can start from, exactly
 * as the engine renders it once passkeys are enabled. Choosing it drives the
 * flow to the `passkey-login` step (see `flow-machine.ts`).
 *
 * Follows `sso-providers.ts` / `branding.ts`: an overlay rather than a fixture
 * edit, so the default mock keeps mirroring the shipped flow byte for byte.
 */
import type { CreateFlow201, CreateFlow201StepActionsItem } from "@zitadel/api/generated/model";

/**
 * Steps a passkey sign-in can start from. Only the identifier here: the machine
 * routes `identifier --SUBMIT(passkey)--> passkey-login`. `sso-conflict` already
 * ships its own passkey action in the fixtures, and `password` / `passkey-login`
 * are reached only after an identifier, so they never carry the offer.
 */
const PASSKEY_STEPS = new Set(["identifier"]);

const PASSKEY_ACTION: CreateFlow201StepActionsItem = {
  name: "passkey",
  kind: "passkey",
  text_key: "identifier.action.passkey",
};

let enabled = false;

export function applyPasskey(on: boolean): void {
  enabled = on;
}

export function clearPasskey(): void {
  enabled = false;
}

/**
 * Add the passkey action to a response's step when that step can start a passkey
 * sign-in and does not already offer one. Returns a new response; `base` is not
 * mutated.
 */
export function withPasskey(base: CreateFlow201): CreateFlow201 {
  if (!enabled || !PASSKEY_STEPS.has(base.step.name)) return base;
  const actions = base.step.actions ?? [];
  if (actions.some((a) => a.name === "passkey")) return base;
  return { ...base, step: { ...base.step, actions: [...actions, PASSKEY_ACTION] } };
}
