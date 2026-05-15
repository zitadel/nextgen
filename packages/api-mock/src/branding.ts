/**
 * Module-level branding overlay applied by the mock handlers.
 *
 * Tests and the dev playground call `applyBranding(...)` to inject a tenant
 * branding payload. Every mock response then ships with that overlay merged
 * into `response.branding`. Calling `clearBranding()` (or `applyBranding(null)`)
 * removes the overlay so subsequent responses go out without a branding block.
 *
 * The overlay type is `CreateFlow201Branding & Record<string, unknown>`:
 * the wire baseline gets full TS guidance (`layout`, `liquid_template`,
 * `logo_url`, `font_url`, `hero_url`), and the open record allows the
 * orchestrator-side v2 extension fields (`palette`, `typography`, `shape`,
 * `assets`, `theme`) without making this package depend on the
 * `@zitadel-nextgen/components` type surface. The orchestrator's branding
 * validator strips anything the OpenAPI doesn't model.
 */
import type {
  CreateFlow201,
  CreateFlow201Branding,
} from "@zitadel-nextgen/api/generated/model";

export type MockBranding = CreateFlow201Branding & Record<string, unknown>;

let overlay: MockBranding | null = null;

export function applyBranding(branding: MockBranding | null | undefined): void {
  overlay = branding ?? null;
}

export function clearBranding(): void {
  overlay = null;
}

/**
 * Shallow-merge the overlay onto a base response. Returns a new response
 * object; `base` is not mutated.
 */
export function withBranding(base: CreateFlow201): CreateFlow201 {
  if (!overlay) return base;
  return {
    ...base,
    branding: { ...overlay } as CreateFlow201["branding"],
  };
}
