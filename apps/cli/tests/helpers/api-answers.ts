import type { OperationName, PageOf, PagedOperation, ZitadelApi } from "@zitadel/api/client";
import { operations } from "@zitadel/api/generated/operations";
import { HttpResponse, http, type JsonBodyType } from "msw";
import type { SetupServer } from "msw/node";

import { createZitadelClient, type ZitadelClient } from "@/lib/backend";

/**
 * The server every {@link testClient} is pointed at. Nothing resolves it: a
 * request reaches no network, only the handlers a test gave its MSW `server`,
 * and one it did not answer fails the test.
 */
export const TEST_SERVER = "http://zitadel.test";

/**
 * A value an answer carries: the shape the generated client declares, with
 * only the fields the test cares about.
 *
 * Field names and their types stay checked, so an answer with a field the
 * contract does not have fails to compile; completeness does not, because an
 * answer that had to spell out every field of a generated response would bury
 * the one value under test.
 */
export type Answer<T> = T extends readonly (infer E)[]
  ? readonly Answer<E>[]
  : T extends object
    ? { [K in keyof T]?: Answer<T[K]> }
    : T;

/** What an operation resolves with when the server answers it. */
type Resolves<K extends OperationName> = Awaited<ReturnType<ZitadelApi[K]>>;

/** One request an operation was sent with, as the server received it. */
export type Sent = Readonly<{
  /** The full URL, its query included. */
  url: URL;
  /** The path parameters, by the names the spec gives them. */
  params: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The JSON body, or `undefined` when there was none. */
  body: unknown;
  /** The request's headers. */
  headers: Headers;
}>;

/**
 * How the server answers an operation: the body to answer `200` with, a
 * `Response` for any other status (a refusal answers its error envelope), or a
 * function of the request that returns either.
 */
export type Reply<K extends OperationName> =
  | Answer<Resolves<K>>
  | Response
  | ((sent: Sent) => Answer<Resolves<K>> | Response | Promise<Answer<Resolves<K>> | Response>);

/**
 * A real CLI client on {@link TEST_SERVER}: the code under test runs every
 * operation through the same transport, URLs, paging and error translation as
 * in production, and a test answers what reaches the server.
 *
 * @returns The client, without its destructive operations until `allowDestructive`.
 */
export function testClient(): ZitadelClient {
  return createZitadelClient({ baseUrl: TEST_SERVER, signal: new AbortController().signal });
}

/**
 * The error envelope the server refuses a request with.
 *
 * @param status - The HTTP status.
 * @param code - The error code, such as `proj.not_found`.
 * @param message - The message the server gives.
 * @returns The response.
 */
export function refusal(status: number, code: string, message = code): Response {
  return HttpResponse.json({ code, message }, { status });
}

/** The method and the MSW path of a generated operation, from the spec's own table. */
function routeOf(operation: OperationName) {
  const found = operations.find((candidate) => {
    return candidate.id.charAt(0).toLowerCase() + candidate.id.slice(1) === operation;
  });
  if (found === undefined) {
    throw new Error(`No operation ${operation} in the spec`);
  }
  const path = found.path.replace(/\{([^}]+)\}/g, ":$1");
  return {
    method: found.method.toLowerCase() as Lowercase<typeof found.method>,
    url: `${TEST_SERVER}/api/v1${path}`,
    paging: found.paging,
  };
}

/** The request as a test reads it. */
async function sentOf(
  request: Request,
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): Promise<Sent> {
  const text = await request.clone().text();
  return {
    url: new URL(request.url),
    params,
    body: text === "" ? undefined : JSON.parse(text),
    headers: request.headers,
  };
}

/**
 * The response a reply's value becomes. A `Response` is copied, because its
 * body can be read once and one reply may answer many requests.
 */
function responseOf(value: unknown): Response {
  if (value instanceof Response) {
    return value.clone();
  }
  if (value === undefined) {
    return new HttpResponse(null, { status: 204 });
  }
  return HttpResponse.json(value as JsonBodyType);
}

/**
 * Answers every request for `operation` with `reply`, and records each one.
 *
 * @param server - The test's MSW server, from the `server` fixture.
 * @param operation - The generated operation, by its client name.
 * @param reply - What the server answers.
 * @returns The requests that arrived, oldest first.
 */
export function answering<K extends OperationName>(
  server: SetupServer,
  operation: K,
  reply: Reply<K>,
): readonly Sent[] {
  const sent: Sent[] = [];
  const { method, url } = routeOf(operation);
  server.use(
    http[method](url, async ({ request, params }) => {
      const received = await sentOf(request, params);
      sent.push(received);
      return responseOf(typeof reply === "function" ? await reply(received) : reply);
    }),
  );
  return sent;
}

/**
 * Answers a paged operation with `pages`, in order: each page but the last
 * carries a cursor, and a request with that cursor gets the next one, whether
 * the operation takes its `page_token` in the query or the body.
 *
 * @param server - The test's MSW server, from the `server` fixture.
 * @param operation - The paged operation, by its client name.
 * @param pages - The pages, first to last.
 * @returns The requests that arrived, oldest first.
 */
export function answeringPages<K extends PagedOperation & OperationName>(
  server: SetupServer,
  operation: K,
  ...pages: readonly Answer<PageOf<K>>[]
): readonly Sent[] {
  const { paging } = routeOf(operation);
  return answering(server, operation, (sent) => {
    const token =
      paging?.token === "body"
        ? (sent.body as { page_token?: string } | undefined)?.page_token
        : sent.url.searchParams.get("page_token");
    const index = token ? Number(token.replace("page-", "")) : 0;
    const page = pages[index] ?? {};
    return responseOf({
      ...page,
      next_page_token: index + 1 < pages.length ? `page-${index + 1}` : null,
    });
  });
}
