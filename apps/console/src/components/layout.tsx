import type { ReactNode } from "react";

/**
 * Page wrapper: centres content, applies the horizontal margin from the Figma
 * layout spec (24px at lg, 32px at 2xl) and vertical rhythm. Every routed page
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

/**
 * 12-column content grid matching the Figma `layout/*` spec. Prefer
 * `--zl-layout-gutter` when the token pipeline emits it; fall back to 24px
 * (`1.5rem`, spacing-6) until Figma publishes that layout token. Column count
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
      className={`grid grid-cols-1 gap-[var(--zl-layout-gutter,1.5rem)] md:grid-cols-12 ${className}`}
    >
      {children}
    </div>
  );
}
