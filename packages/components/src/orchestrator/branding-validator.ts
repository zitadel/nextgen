/**
 * Lightweight paint-time validator for `Branding` payloads.
 *
 * Per `docs/design/branding/schema.md` §Shape invariants:
 *
 * 1. Every referenced URL is https.
 * 2. `layout` is in the documented enum.
 * 3. `liquid_template` shape checks happen elsewhere (security pipeline runs
 *    server-side; structural validator is deferred until the full atom set
 *    lands).
 *
 * Failures are non-fatal: we collect issues, log a dev-build warning, and
 * return a sanitised payload with the offending fields stripped so the
 * orchestrator falls back to the bundled defaults.
 */
import type { Branding, FlowLayout } from "./types.js";

const VALID_LAYOUTS: readonly FlowLayout[] = ["centered", "split"];

export type BrandingValidationResult = {
  branding: Branding | undefined;
  issues: readonly string[];
};

export function validateBranding(input: Branding | undefined): BrandingValidationResult {
  if (!input) {
    return { branding: undefined, issues: [] };
  }

  const issues: string[] = [];
  const out: Branding = { ...input };

  if (out.layout && !VALID_LAYOUTS.includes(out.layout)) {
    issues.push(`Unknown layout "${out.layout}" — falling back to "centered".`);
    out.layout = "centered";
  }

  out.logo_url = sanitiseUrl(out.logo_url, "logo_url", issues);
  out.font_url = sanitiseUrl(out.font_url, "font_url", issues);
  out.hero_url = sanitiseUrl(out.hero_url, "hero_url", issues);
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
  value: string | null | undefined,
  field: string,
  issues: string[],
): string | null | undefined {
  if (value == null || value === "") {
    return value ?? undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      issues.push(`${field} must use https (got "${parsed.protocol}") — dropped.`);
      return null;
    }
    return parsed.toString();
  } catch {
    issues.push(`${field} is not a valid URL — dropped.`);
    return null;
  }
}
