/**
 * Construct a JSON `Response` with `Content-Type: application/json`.
 *
 * @param body - Value to serialise with `JSON.stringify`.
 * @param status - HTTP status code; defaults to `200`.
 */
export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
