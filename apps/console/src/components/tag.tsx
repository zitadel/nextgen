import type { ReactNode } from "react";

/**
 * Console-local Tag chip — the DS `Tag` (aka "Chip"): Arimo caption (12/16),
 * 8px inline / 2px block padding, 4px radius, on a subtle raised surface.
 *
 * Surface is the canonical `surface/subtle` (chip is not in the exported
 * variable set; `surface/subtle` is the semantic "subtle raised surface" and
 * flips correctly light/dark). In the DS the chip text follows its host's text
 * tone (secondary on an inactive nav row, primary on an active one) — hence `tone`.
 */
const TAG_BASE =
  "inline-flex items-center justify-center rounded-zl-xs bg-zl-surface-subtle px-2 py-0.5 text-xs leading-4 tabular-nums";
const TAG_TONE = {
  primary: "text-zl-text-primary",
  secondary: "text-zl-text-secondary",
} as const;

export function Tag({
  children,
  tone = "primary",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof TAG_TONE;
  className?: string;
}) {
  const cls = `${TAG_BASE} ${TAG_TONE[tone]}${className ? ` ${className}` : ""}`;
  return <span className={cls}>{children}</span>;
}
