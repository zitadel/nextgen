/**
 * Module-level identity-provider overlay applied by the mock handlers.
 *
 * The shipped login flow (`packages/config/defaults/default-login.json`) has
 * no providers — they arrive only when a project runs `zitadel sso enable` —
 * and the fixtures here mirror that flow, so none is offered by default.
 * Tests and the dev playground opt in with `applySsoProviders([...])`, which
 * adds the entries to every step that can start a sign-in, exactly as the
 * engine renders them once a connection exists.
 *
 * Follows `branding.ts`: an overlay rather than a fixture edit, so the
 * default mock keeps mirroring the shipped flow byte for byte.
 */
import type { CreateFlow201, CreateFlow201StepSsoProvidersItem } from "@zitadel/api/generated/model";

export type MockSsoProvider = CreateFlow201StepSsoProvidersItem;

// `id` is the connection's slug — what the client sends back as
// `sso_provider_id` and what the flow definition references.

/**
 * Steps the engine attaches providers to: the ones a sign-in can start from.
 * `password` is reached only after an identifier, so it never carries them —
 * the same rule the CLI's generator applies when writing the flow file.
 */
const PROVIDER_STEPS = new Set(["identifier", "register", "passkey-login"]);

let overlay: readonly MockSsoProvider[] = [];

export function applySsoProviders(providers: readonly MockSsoProvider[] | null | undefined): void {
  overlay = providers ?? [];
}

export function clearSsoProviders(): void {
  overlay = [];
}

/**
 * Add the overlay to a response's step when that step can start a sign-in.
 * Returns a new response; `base` is not mutated.
 */
export function withSsoProviders(base: CreateFlow201): CreateFlow201 {
  if (overlay.length === 0 || !PROVIDER_STEPS.has(base.step.name)) {
    return base;
  }
  return { ...base, step: { ...base.step, sso_providers: [...overlay] } };
}
