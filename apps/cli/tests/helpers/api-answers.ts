import type { OperationName, PageOf, PagedOperation, ZitadelApi } from "@zitadel/api/client";
import type * as schemas from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { operations } from "@zitadel/api/generated/operations";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import type { z } from "zod";

import { createZitadelClient, type ZitadelClient } from "@/lib/backend";
import type { HeldVariable } from "@tests/helpers/records";

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

/**
 * The body an operation takes, as its generated schema types what a client
 * sends (before any default is filled in): `createTeam` takes the input of
 * `CreateTeamBody`. `undefined` for an operation without a body.
 */
export type BodyOf<K extends OperationName> = `${Capitalize<K>}Body` extends keyof typeof schemas
  ? z.input<(typeof schemas)[`${Capitalize<K>}Body`]>
  : undefined;

/**
 * One request an operation was sent with, as the server received it. Without
 * an operation named, the body is `unknown`, for code that reads any request.
 */
export type Sent<K extends OperationName | undefined = undefined> = Readonly<{
  /** The full URL, its query included. */
  url: URL;
  /** The path parameters, by the names the spec gives them. */
  params: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The JSON body the client sent, typed as the operation's body. */
  body: K extends OperationName ? BodyOf<K> : unknown;
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
  | ((sent: Sent<K>) => Answer<Resolves<K>> | Response | Promise<Answer<Resolves<K>> | Response>);

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

/** MSW's handler for each method the spec uses. */
const VERBS = {
  GET: http.get,
  PUT: http.put,
  POST: http.post,
  DELETE: http.delete,
  PATCH: http.patch,
} as const;

/** The MSW handler and path of a generated operation, from the spec's own table. */
function routeOf(operation: OperationName) {
  const found = operations.find((candidate) => {
    return candidate.id.charAt(0).toLowerCase() + candidate.id.slice(1) === operation;
  });
  if (found === undefined) {
    throw new Error(`No operation ${operation} in the spec`);
  }
  const path = found.path.replace(/\{([^}]+)\}/g, ":$1");
  return {
    handle: VERBS[found.method],
    url: `${TEST_SERVER}/api/v1${path}`,
    paging: found.paging,
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
  return new HttpResponse(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
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
): readonly Sent<K>[];
export function answering(
  server: SetupServer,
  operation: OperationName,
  reply: unknown,
): readonly Sent[] {
  const sent: Sent[] = [];
  const { handle, url } = routeOf(operation);
  server.use(
    handle(url, async ({ request, params }) => {
      const text = await request.clone().text();
      const received: Sent = {
        url: new URL(request.url),
        params,
        body: text === "" ? undefined : JSON.parse(text),
        headers: request.headers,
      };
      sent.push(received);
      return responseOf(typeof reply === "function" ? await reply(received) : reply);
    }),
  );
  return sent;
}

/**
 * Answers a paged operation with `pages`, in order: each page but the last
 * carries a cursor, and a request with that cursor gets the next one, whether
 * the operation takes its `page_token` in the query or the body. A cursor it
 * did not hand out is refused with a `400`, so a walk that sends the wrong one
 * fails rather than reading an empty page.
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
): readonly Sent<K>[] {
  const { paging } = routeOf(operation);
  return answering(server, operation, (sent) => {
    const { body } = sent;
    const token =
      paging?.token !== "body"
        ? sent.url.searchParams.get("page_token")
        : typeof body === "object" && body !== null && "page_token" in body
          ? body.page_token
          : undefined;
    const index = token ? pages.findIndex((_, at) => `page-${at}` === token) : 0;
    const page = pages[index];
    if (page === undefined) {
      return refusal(400, "test.unknown_page_token", `no page was handed out as ${token}`);
    }
    return responseOf({
      ...page,
      next_page_token: index + 1 < pages.length ? `page-${index + 1}` : null,
    });
  });
}

/**
 * Answers the project's variables, as `listVariables` holds them.
 *
 * @param server - The test's MSW server, from the `server` fixture.
 * @param held - The values, by variable name.
 * @param kind - The one kind that holds them; left out, every kind does.
 * @returns The requests that read them, oldest first.
 */
export function answeringVariables(
  server: SetupServer,
  held: Readonly<Record<string, HeldVariable>>,
  kind?: "primary" | "preview",
): readonly Sent[] {
  return answering(server, "listVariables", ({ url }) => {
    const asked = url.searchParams.get("kind") === "preview" ? "preview" : "primary";
    if (kind !== undefined && asked !== kind) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(held).map(([name, value]) => {
        return [name, { [asked]: value }];
      }),
    );
  });
}
