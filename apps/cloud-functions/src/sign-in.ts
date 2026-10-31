import { passProtection, zitadelServer } from "./zitadel";

/** Where the console's add-on points the sign-in widget (`signInApiBase`). */
export const SIGN_IN_PREFIX = "/cloud/zitadel";

/** A BotID verdict, as `checkBotId()` answers it. */
export interface BotVerdict {
  isBot: boolean;
  isVerifiedBot: boolean;
}

/**
 * The prefix the server answers the API under (ADR 077). Until 1.0.0 it also
 * answers the same operations at the root, so a widget may call either.
 */
const API_PREFIX = "/api/v1";

/**
 * The widget's two calls that start or advance a sign-in or sign-up: what a
 * bot would script, with or without the API prefix. Everything else under
 * the prefix (sessions, CSRF, a flow's state) passes unchecked.
 */
export function isFlowWrite(method: string, path: string): boolean {
  const operation = path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
  return method === "POST" && (operation === "/flow" || /^\/flow\/[^/]+\/submit$/.test(operation));
}

/**
 * A path as the widget spells it: segments of unreserved characters, none
 * empty, no trailing slash. Every path of the API fits, ids included. The
 * server routes the path it decodes, so `/%66low` is its `/flow`; any other
 * spelling is refused before `isFlowWrite` reads it, never guessed at.
 */
const PLAIN_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;

/** Headers that describe one hop, never the request itself. */
const HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/**
 * One of the sign-in widget's calls, forwarded to the Zitadel server
 * (`zitadelServer`) with its cookies, `Origin` and body (root ADR 084 §5),
 * after BotID's check for a flow write. The server sees the request the widget
 * made, so the session cookie it sets reaches the browser unchanged.
 *
 * A bad verdict is refused until the server reads ADR 019's risk signal;
 * then the verdict travels as that header and nothing is refused here.
 */
export async function forwardSignIn(
  request: Request,
  verdict: () => Promise<BotVerdict>,
  server = zitadelServer(request),
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(SIGN_IN_PREFIX.length) || "/";
  if (!PLAIN_PATH.test(path)) {
    // The server's own answer to a path it does not serve (ADR 076).
    return Response.json(
      { code: "req.not_found", message: "No API operation matches this path." },
      { status: 404 },
    );
  }
  if (isFlowWrite(request.method, path)) {
    const { isBot, isVerifiedBot } = await verdict();
    if (isBot && !isVerifiedBot) {
      // The server's own error envelope (root ADR 030), so the widget shows it
      // as it shows a refused step.
      return Response.json(
        { code: "auth.bot_suspected", message: "This browser could not be verified. Try again." },
        { status: 403 },
      );
    }
  }
  const headers = passProtection(new Headers(request.headers));
  for (const name of HOP_HEADERS) headers.delete(name);
  const answer = await fetch(new URL(`${path}${url.search}`, server), {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });
  const out = new Headers(answer.headers);
  // fetch decoded the body, so its encoding and length no longer apply.
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(answer.body, { status: answer.status, headers: out });
}
