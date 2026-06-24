const DISABLED_VALUES = new Set(["", "0", "false", "off", "no"]);

/**
 * Whether an environment variable is set to an enabled value. A present-but-
 * falsey string (`CI=false`, `CI=0`) counts as disabled — unlike a bare
 * `Boolean(env.CI)` check, which is true for any non-empty string.
 */
export function envEnabled(value: string | undefined): boolean {
  return value !== undefined && !DISABLED_VALUES.has(value.trim().toLowerCase());
}
