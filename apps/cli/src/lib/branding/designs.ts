import type { BrandingDesign } from "@zitadel/config/defaults";

/**
 * Human-facing name and one-line hint for each shipped login design. Shared
 * by the setup wizard, `branding eject`, and the setup summary so the label a
 * user picks ("Split (reversed)") and the slug the machine records
 * (`split-right`) stay visibly paired everywhere — the summary echoing a slug
 * the prompt never showed reads as "did my selection apply?".
 */
export const BRANDING_DESIGN_INFO: Record<BrandingDesign, { label: string; hint: string }> = {
  centered: {
    label: "Centered",
    hint: "the built-in look, forked as an editable template",
  },
  split: {
    label: "Split",
    hint: "brand panel left, form right; narrow containers show a compact brand mark",
  },
  "split-right": {
    label: "Split (reversed)",
    hint: "form left, brand panel right; narrow containers show a compact brand mark",
  },
  hero: {
    label: "Hero",
    hint: "landing-style brand pane left, form right; editable text fallback when narrow",
  },
  minimal: {
    label: "Minimal",
    hint: "no card chrome, fields straight on the page",
  },
};

/** The prompt label for a design slug, falling back to the slug itself. */
export function brandingDesignLabel(design: string): string {
  return (BRANDING_DESIGN_INFO as Record<string, { label: string }>)[design]?.label ?? design;
}
