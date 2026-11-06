import { publishedSides } from "@zitadel/components";
import { type LucideIcon, Moon, Sun, SunMoon } from "lucide-react";
import type { PreviewJourney, PreviewState } from "@/features/branding/components/login-preview";
import type { BrandingRevision } from "@/features/branding/branding-palette";

/** A flow the preview can run, the purposes it serves, and its terminal screen. */
export type PreviewFlow = { name: string; label: string; purposes: string[]; successStep?: string };

/**
 * The step a flow ends on a screen with: its one `complete: "show"` step. A
 * flow that declares none, or several, leaves the choice to the element.
 */
export function successStepName(
  steps: { name: string; complete?: string }[] = [],
): string | undefined {
  const shown = steps.filter((step) => step.complete === "show");
  return shown.length === 1 ? shown[0]?.name : undefined;
}

// Passkey is absent: it needs a step the flow only reaches after an
// identifier, which the preview cannot ask for (the element shows the entry
// step in a chosen state; a later step exists only once the server has walked
// the flow to it), and a tab that renders the sign-in step under another name
// claims a journey it does not preview.
export const JOURNEYS: { id: PreviewJourney; label: string }[] = [
  { id: "register", label: "Sign up" },
  { id: "login", label: "Sign in" },
];

// The states of the design's selector, in its order. All of them are the
// element's own rendering of the step the project serves; none writes to it.
// Keyed by state, so one the element gains has to be labelled here to compile.
export const STATE_LABELS: Record<PreviewState, string> = {
  default: "Default",
  validation_error: "Validation errors",
  submission_error: "Submission error",
  loading: "Loading",
  success: "Success",
};

/**
 * Which side the preview paints: a fixed side, or `revision` to leave it to
 * the revision's own `theme.mode` — what a visitor gets.
 */
export type PreviewTheme = "light" | "dark" | "revision";

// The menu's order, with the user menu's icons, so the trigger shows the side
// on screen. Keyed like `STATE_LABELS`, so a new side has to be labelled here.
export const THEMES: Record<PreviewTheme, { label: string; icon: LucideIcon }> = {
  revision: { label: "From branding", icon: SunMoon },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
};

/**
 * The side a revision that publishes only the other one cannot paint. The
 * element then paints the published side whatever it is asked for
 * (`publishedSides`); with both or neither published, either side paints.
 */
export function unpublishedSide(revision: BrandingRevision): PreviewTheme | undefined {
  const [only, second] = publishedSides(revision);
  if (!only || second) return undefined;
  return only === "light" ? "dark" : "light";
}

/** What "From branding" paints, resolved as the element does it. */
export function revisionSide(revision: BrandingRevision): string {
  const [only, second] = publishedSides(revision);
  if (only && !second) return THEMES[only].label;
  const mode = revision.theme?.mode;
  // `auto`, and an unset mode, which a widget treats as `auto`, follow the
  // operator's operating system, not the console's own theme.
  return mode === "light" || mode === "dark" ? THEMES[mode].label : "System";
}
