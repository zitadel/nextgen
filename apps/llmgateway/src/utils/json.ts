/**
 * Discriminated result of attempting to parse a JSON string.
 *
 * Modelled as a tagged union rather than `T | null` so callers can
 * distinguish "parsed `null` successfully" from "parse failed".
 */
export type JsonParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: SyntaxError };

/**
 * Parse a UTF-8 JSON string without throwing. Empty input is treated as a
 * parse failure (callers should branch on length first if they want to
 * accept empty bodies).
 *
 * @example
 *   const result = tryParseJson<{ a: number }>(raw);
 *   if (result.ok) {
 *     handle(result.value.a);
 *   } else {
 *     return badRequest();
 *   }
 */
export function tryParseJson<T = unknown>(raw: string): JsonParseResult<T> {
	try {
		return { ok: true, value: JSON.parse(raw) as T };
	} catch (err) {
		return { ok: false, error: err instanceof SyntaxError ? err : new SyntaxError(String(err)) };
	}
}

/**
 * Type guard for "value is a non-null, non-array object" — the shape we
 * inject system prompts into.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
