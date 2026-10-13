/**
 * Quote a value for safe interpolation into a `nextCommands` string an agent or
 * a human may paste into a shell. Values that come from the project or the
 * server — an origin, a cursor, a filter — are untrusted: origin validation
 * permits shell metacharacters, so a value such as one containing `$()` must not
 * be emitted raw into an executable command. A value made only of shell-safe
 * characters is returned as-is; anything else is wrapped in single quotes with
 * embedded quotes escaped.
 */
export const shellArg = (value: string): string =>
  /^[A-Za-z0-9_.:@/=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
