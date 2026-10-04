import type { ReactNode } from "react";

/**
 * Page wrapper: centres content, applies the horizontal margin (24px at lg,
 * 32px at 2xl) and vertical rhythm. Every routed page
 * renders inside one so the shell's <main> stays padding-free.
 *
 * Do not write Tailwind's built-in centring utility name (the "c" word) anywhere
 * in scanned source, even in a comment: its extractor would emit that utility,
 * whose max-width tiers reference the var()-based --zl-breakpoint-* tokens inside
 * an @media condition, which lightningcss cannot minify and the build fails. This
 * app uses explicit max-w-* + the grid below instead.
 */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[120rem] px-6 py-8 2xl:px-8">{children}</div>
  );
}

/** The fixed column every settings screen renders in, centred in the main area. */
export function SettingsColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-(--zl-container-settings)">{children}</div>;
}

/**
 * 12-column content grid with a 24px gutter. Column count
 * is hard-coded as `grid-cols-12` because CSS does not allow a `var()` as the
 * `repeat()` count. Collapses to a single column below `md`.
 */
export function ContentGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-6 md:grid-cols-12 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The page wrapper for a configuration detail screen — the ones that render a
 * single panel card rather than a title row over a table.
 *
 * The design insets that panel by 24px on every side, and by 16px on the sides
 * in its narrow variant. Shared because the schema and login-flow screens are
 * the same composition. Resource detail screens (users, teams, projects)
 * are a different composition: a title row over cards, drawn by `DetailPage`
 * and `DetailHeader` in `detail-page.tsx`.
 */
export const DETAIL_PANEL_PAGE = "px-4 py-6 sm:px-6";
