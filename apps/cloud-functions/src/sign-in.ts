import { API_PREFIX } from "@zitadel/api/runtime/base-url";

import { FLOW_COLLECTIONS, SIGN_IN_PREFIX } from "./contract";
import { passProtection, zitadelServer } from "./zitadel";

/** A BotID verdict, as `checkBotId()` answers it. */
export interface BotVerdict {
  isBot: boolean;
  isVerifiedBot: boolean;
}

/** What follows a flow collection in a submit: one flow's id, then `submit`. */
const SUBMIT_OF_ONE_FLOW = /^\/[^/]+\/submit$/;

/**
 * The widget's two calls that start or advance a sign-in or sign-up: what a
 * bot would script, with or without the API prefix, on either of the
 * collections the server answers them at (`FLOW_COLLECTIONS`). The old
 * `/flow` is the same write as `/flows` for as long as the server answers it.
 * Everything else under the prefix (sessions, CSRF, a flow's state, the flow
 * definitions) passes unchecked.
 */
export function isFlowWrite(method: string, path: string): boolean {
  if (method !== "POST") return false;
  const operation = path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
  return FLOW_COLLECTIONS.some(
    (collection) =>
      operation === collection ||
      (operation.startsWith(`${collection}/`) &&
        SUBMIT_OF_ONE_FLOW.test(operation.slice(collection.length))),
  );
}

/**
 * A path as the widget spells it: segments of unreserved characters, none
 * empty, no trailing slash. Every path of the API fits, ids included. The
 * server routes the path it decodes, so `/%66lows` is its `/flows` and
 * `/%66low` its `/flow`; any other spelling is refused before `isFlowWrite`
 * reads it, never guessed at.
 */
const PLAIN_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;

/**
 * Whether the server's API answers the path. The widget calls nothing else
 * (`apiBaseUrl`), and the server's origin is every other service's too: an
 * open path would fetch the docs, the website or these functions again, each
 * `/cloud/zitadel` in it one more invocation, with a preview's bypass secret.
 */
export function isApiPath(path: string): boolean {
  return (
    PLAIN_PATH.test(path) &&
    path.startsWith(`${API_PREFIX}/`) &&
    // `new URL` resolves these, which would lead out of the prefix again. A
    // request's own URL arrives resolved; this holds for any other caller.
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

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
  if (!isApiPath(path)) {
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
