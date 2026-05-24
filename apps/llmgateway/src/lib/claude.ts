import { jsonResponse } from "../utils/response.js";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION_PREFIX = "v1";
const ANTHROPIC_BETA_QUERY_PARAM = "beta";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export type ClaudeAuth =
	| { readonly mode: "oauth"; readonly token: string; readonly refreshToken?: string }
	| { readonly mode: "apiKey"; readonly key: string };

function buildHeaders(input: Headers, auth: ClaudeAuth, hasJsonBody: boolean): Headers {
	const out = new Headers(input);

	// Remove all client-supplied auth headers before writing gateway auth so
	// they cannot leak upstream. Both must be cleared: the client may send
	// either (e.g. the Anthropic SDK always sends x-api-key regardless of
	// auth mode) and Anthropic prioritises x-api-key over Bearer when both
	// are present, which would bypass the gateway's credential injection.
	out.delete("authorization");
	out.delete("x-api-key");

	if (auth.mode === "oauth") {
		out.set("authorization", `Bearer ${auth.token}`);
		const existingBeta = out.get("anthropic-beta");
		if (existingBeta === null) {
			out.set("anthropic-beta", ANTHROPIC_OAUTH_BETA);
		} else {
			const alreadyPresent = existingBeta
				.split(",")
				.map((s) => s.trim())
				.includes(ANTHROPIC_OAUTH_BETA);
			if (!alreadyPresent) {
				out.set("anthropic-beta", `${existingBeta},${ANTHROPIC_OAUTH_BETA}`);
			}
		}
	} else {
		out.set("x-api-key", auth.key);
	}

	if (!out.has("anthropic-version")) {
		out.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
	}

	if (hasJsonBody) {
		out.set("content-type", "application/json");
	}

	return out;
}

export class ClaudeService {
	readonly #auth: ClaudeAuth;
	readonly #transport: {
		call(
			url: string,
			method: string,
			headers: Headers,
			body?: string,
			onDebug?: (url: string, status: number) => void,
		): Promise<Response>;
	};

	constructor(options: {
		readonly auth: ClaudeAuth;
		readonly transport: {
			call(
				url: string,
				method: string,
				headers: Headers,
				body?: string,
				onDebug?: (url: string, status: number) => void,
			): Promise<Response>;
		};
	}) {
		this.#auth = options.auth;
		this.#transport = options.transport;
	}

	async call(options: {
		readonly pathSegments: ReadonlyArray<string>;
		readonly search: string;
		readonly method: string;
		readonly requestHeaders: Headers;
		readonly body?: string;
		readonly onBody?: (body: string) => string | null;
		readonly onDebug?: (url: string, status: number) => void;
	}): Promise<Response> {
		const url = new URL(
			`${ANTHROPIC_API_ORIGIN}/${ANTHROPIC_API_VERSION_PREFIX}/${options.pathSegments.join("/")}`,
		);
		const searchParams = new URLSearchParams(options.search);
		searchParams.delete(ANTHROPIC_BETA_QUERY_PARAM);
		url.search = searchParams.toString();

		const body =
			options.body === undefined
				? undefined
				: options.onBody
					? options.onBody(options.body)
					: options.body;

		if (body === null) {
			return jsonResponse(
				{ error: "invalid_json", message: "Request body is not valid JSON" },
				400,
			);
		}

		const headers = buildHeaders(options.requestHeaders, this.#auth, body !== undefined && body.length > 0);
		return this.#transport.call(url.toString(), options.method, headers, body, options.onDebug);
	}
}
