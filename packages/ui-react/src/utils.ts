/**
 * Tiny class-name joiner. We intentionally don't pull in clsx/classnames —
 * the shared surface is small and we want zero runtime deps beyond React.
 */
export function cx(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
