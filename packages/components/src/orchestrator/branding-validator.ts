/**
 * Lightweight paint-time validator for `Branding` payloads.
 *
 * Per `docs/design/branding/schema.md` §Shape invariants:
 *
 * 1. Every referenced URL is https, except logo/hero assets may use canonical
 *    loopback HTTP while the component itself renders on a loopback HTTP
 *    origin.
 * 2. `layout` is in the documented enum.
 * 3. `liquid_template` shape checks happen elsewhere (security pipeline runs
 *    server-side; structural validator is deferred until the full atom set
 *    lands).
 *
 * Failures are non-fatal: we collect issues, log a dev-build warning, and
 * return a sanitised payload with the offending fields stripped (set to
 * `undefined`) so the orchestrator falls back to the bundled defaults.
 */
import { CreateFlow201BrandingLayout } from "@zitadel/api/generated/model";
import { isCanonicalLoopbackHttpUrl } from "@zitadel/config/branding-url";

import type { Branding } from "./branding.js";

const VALID_LAYOUTS = new Set<string>(Object.values(CreateFlow201BrandingLayout));

export type BrandingValidationResult = {
  branding: Branding | undefined;
  issues: readonly string[];
};

export type BrandingValidationContext = {
  /** Origin of the document that will paint the branding payload. */
  renderingOrigin?: string;
};

export function validateBranding(
  input: Branding | undefined,
  context: BrandingValidationContext = {},
): BrandingValidationResult {
  if (!input) {
    return { branding: undefined, issues: [] };
  }

  const issues: string[] = [];
  const out: Branding = { ...input };
  const allowLoopbackHttp =
    context.renderingOrigin !== undefined && isCanonicalLoopbackHttpUrl(context.renderingOrigin);

  if (out.layout && !VALID_LAYOUTS.has(out.layout)) {
    issues.push(`Unknown layout "${out.layout}" — falling back to "centered".`);
    out.layout = CreateFlow201BrandingLayout.centered;
  }

  out.logo_url = sanitiseUrl(out.logo_url, "logo_url", issues, { allowed: allowLoopbackHttp });
  out.font_url = sanitiseUrl(out.font_url, "font_url", issues);
  out.hero_url = sanitiseUrl(out.hero_url, "hero_url", issues, { allowed: allowLoopbackHttp });
  if (out.assets) {
    out.assets = {
      logo_dark: sanitiseUrl(out.assets.logo_dark, "assets.logo_dark", issues),
      favicon: sanitiseUrl(out.assets.favicon, "assets.favicon", issues),
      background_image: sanitiseUrl(out.assets.background_image, "assets.background_image", issues),
    };
  }

  return { branding: out, issues };
}

function sanitiseUrl(
  value: string | undefined,
  field: string,
  issues: string[],
  loopbackHttp?: { allowed: boolean },
): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    // Only logo/hero URLs opt into this policy, and only while the containing
    // page is itself on loopback. That keeps a persisted development URL from
    // making a public login page request resources from each visitor's device.
    if (parsed.protocol === "http:" && loopbackHttp?.allowed && isCanonicalLoopbackHttpUrl(value)) {
      return parsed.toString();
    }
    if (parsed.protocol !== "https:") {
      const loopbackHint = loopbackHttp
        ? "; canonical loopback http is allowed only on loopback development pages"
        : "";
      issues.push(`${field} must use https (got "${parsed.protocol}"${loopbackHint}) — dropped.`);
      return undefined;
    }
    return parsed.toString();
  } catch {
    issues.push(`${field} is not a valid URL — dropped.`);
    return undefined;
  }
}
