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
 * Steps a passkey sign-in can start from, mapped to the text key the engine
 * renders the action with. The machine routes both
 * `identifier --SUBMIT(passkey)--> passkey-login` and
 * `password --SUBMIT(passkey)--> passkey-login`, and the canonical passkey-first
 * preset offers the action on both steps with these per-step keys
 * (`packages/config/defaults/presets/passkey-first/login.json`). `sso-conflict`
 * already ships its own passkey action in the fixtures, and `passkey-login` is
 * the ceremony step itself, so neither carries the offer.
 */
const PASSKEY_STEP_TEXT_KEYS = new Map<string, string>([
  ["identifier", "identifier.action.passkey"],
  ["password", "password.action.passkey"],
]);

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
  const textKey = PASSKEY_STEP_TEXT_KEYS.get(base.step.name);
  if (!enabled || textKey === undefined) return base;
  const actions = base.step.actions ?? [];
  if (actions.some((a) => a.name === "passkey")) return base;
  const action: CreateFlow201StepActionsItem = {
    name: "passkey",
    kind: "passkey",
    text_key: textKey,
  };
  return { ...base, step: { ...base.step, actions: [...actions, action] } };
}
