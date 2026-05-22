/**
 * Whether verbose gateway logging is enabled.
 *
 * Enabled in every environment except `NODE_ENV=production`, so:
 *
 * - Local dev (`tsx scripts/dev.ts`): on.
 * - Vercel preview deployments: on.
 * - Vercel production deployments: off.
 *
 * @param env - Source environment. Defaulted to `process.env` so callers may
 *   inject a stub in tests.
 */
export function isDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env["NODE_ENV"] !== "production";
}

/**
 * Truncate a string for safe logging. Returns the original when under the
 * limit; otherwise returns the prefix with a trailing ellipsis marker.
 */
export function truncateForLog(value: string, maxLength = 2000): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}\n…[truncated]` : value;
}
