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
 * return a sanitised payload with the offending fields stripped (set to
 * `undefined`) so the orchestrator falls back to the bundled defaults.
 */
import { CreateFlow201BrandingLayout } from "@zitadel/api/generated/model";

import type { Branding } from "./branding.js";

const VALID_LAYOUTS = new Set<string>(Object.values(CreateFlow201BrandingLayout));

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

  if (out.layout && !VALID_LAYOUTS.has(out.layout)) {
    issues.push(`Unknown layout "${out.layout}" — falling back to "centered".`);
    out.layout = CreateFlow201BrandingLayout.centered;
  }

  out.logo_url = sanitiseUrl(out.logo_url, "logo_url", issues);
  out.font_url = sanitiseUrl(out.font_url, "font_url", issues);
  out.hero_url = sanitiseUrl(out.hero_url, "hero_url", issues);
  if (out.assets) {
    out.assets = {
      logo_dark: sanitiseUrl(out.assets.logo_dark, "assets.logo_dark", issues),
      favicon: sanitiseUrl(out.assets.favicon, "assets.favicon", issues),
      background_image: sanitiseUrl(
        out.assets.background_image,
        "assets.background_image",
        issues,
      ),
    };
  }

  return { branding: out, issues };
}

function sanitiseUrl(
  value: string | undefined,
  field: string,
  issues: string[],
): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    // Loopback HTTP is the dev-posture carve-out (assets served from the
    // app's own dev server). Mirrors the save gates in
    // internal/domain/branding_validator.go and @zitadel/config schemas —
    // keep the three predicates aligned.
    if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
      return parsed.toString();
    }
    if (parsed.protocol !== "https:") {
      issues.push(
        `${field} must use https (got "${parsed.protocol}"; http is allowed for localhost only) — dropped.`,
      );
      return undefined;
    }
    return parsed.toString();
  } catch {
    issues.push(`${field} is not a valid URL — dropped.`);
    return undefined;
  }
}

/** Loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) allowed on http. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === "::1") {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
