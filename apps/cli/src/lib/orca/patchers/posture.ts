import type { ScaffoldPosture } from "../../sync/types";

/**
 * Frameworks whose patchers add route files without owning the app shell —
 * the only ones where a pre-existing app keeps a layout for the widget
 * posture to inherit (ADR 044). The SPA families write the app's root
 * component, so nothing survives for a widget to embed into; they keep the
 * page posture until a non-destructive route/layout insertion contract
 * exists for their routers.
 *
 * SvelteKit, SolidStart, Qwik Router and TanStack Start now skip the shell and
 * landing page on a pre-existing app too, but stay out of this set until their
 * page templates honour `ctx.posture`: Next and Nuxt render `variant="widget"`
 * cards in a layout-neutral wrapper for the widget posture, whereas the four
 * ignore posture and always paint page chrome, so recording `widget` for them
 * would misdescribe what was written.
 */
const ROUTE_BASED_FRAMEWORKS: ReadonlySet<string> = new Set(["next", "nuxt"]);

/**
 * The default embedding posture of the scaffolded auth/profile pages
 * (ADR 044), derived from the same hinge as the framework homepage: whether
 * setup created the app skeleton itself. A fresh scaffold has no design to
 * respect — full-page chrome is the strongest start. A pre-existing
 * route-based app has its own shell and theme, so the pages embed
 * `variant="widget"` cards in a layout-neutral wrapper instead of painting
 * token-colored chrome underneath the host layout.
 *
 * Derived once at setup time and recorded in the scaffold manifest;
 * `doctor --fix` restores from the record rather than re-deriving (a
 * manifest-less legacy scaffold could not answer the hinge).
 */
export function derivePosture(frameworkId: string, scaffoldedFramework: boolean): ScaffoldPosture {
  if (!ROUTE_BASED_FRAMEWORKS.has(frameworkId)) {
    return "page";
  }
  return scaffoldedFramework ? "page" : "widget";
}
