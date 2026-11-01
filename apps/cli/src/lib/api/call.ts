import { ApiError, request as fetchWithPolicy } from "@zitadel/api/runtime/fetch";
import { itemsOf, nextToken } from "@zitadel/api/runtime/paging";

import { REQUEST_TIMEOUT_MS, sanitizeRejection, sanitizeResponse } from "../api-client";
import { ZitadelError } from "../errors";
import { isObject } from "../json";
import { interruptSignal } from "../interrupt";
import { collectPages } from "../oclif/crud/paging";
import { type ApiRequest, urlOf } from "./request";

/** What the server answered. `body` is `undefined` for a response without one. */
export type ApiResponse = Readonly<{ status: number; body: unknown }>;

/** The response body: JSON where the server says so, text otherwise. */
const readBody = async (res: Response): Promise<unknown> => {
  if ([204, 205, 304].includes(res.status)) {
    return undefined;
  }
  const raw = await res.text();
  if (raw === "") {
    return undefined;
  }
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

/**
 * Send one request to `server`, with the project secret as the bearer when
 * there is one. It is bounded and cancelled as every platform call is
 * (`createZitadelClient`), and what the server says is escaped the same way:
 * a non-2xx is the {@link ApiError} `toZitadelError` maps to an exit code.
 */
export const send = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
): Promise<ApiResponse> => {
  const { status, raw } = await sendRaw(server, token, request);
  return { status, body: sanitizeResponse(raw) };
};

/** {@link send}, answering the body as the server sent it; a failure is escaped all the same. */
const sendRaw = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
): Promise<{ status: number; raw: unknown }> => {
  const url = urlOf(server, request);
  const { method } = request.operation;
  const headers = new Headers({ accept: "application/json" });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const { res, rawBody } = await fetchWithPolicy(
    url,
    {
      method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    },
    { signal: interruptSignal(), timeoutMs: REQUEST_TIMEOUT_MS },
    readBody,
  );
  if (!res.ok) {
    sanitizeRejection(
      new ApiError(res.status, url, rawBody, `${method} ${url} returned ${res.status}`),
    );
  }
  return { status: res.status, raw: rawBody };
};

/** The request for the page `token` names; `undefined` leaves the request as it is. */
const pageOf = (request: ApiRequest, token: string | undefined): ApiRequest => {
  const paging = request.operation.paging;
  if (token === undefined || paging === null) {
    return request;
  }
  if (paging.token === "query") {
    return {
      ...request,
      query: [...request.query.filter(([name]) => name !== "page_token"), ["page_token", token]],
    };
  }
  return { ...request, body: { ...(request.body as Record<string, unknown>), page_token: token } };
};

/**
 * Send a paged request until the server's `next_page_token` runs out, and
 * answer the last page with the page field holding every page's items. The
 * walk is `collectPages`, the resource lists' `--all`.
 */
export const sendAll = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
): Promise<ApiResponse> => {
  const paging = request.operation.paging;
  if (paging === null) {
    return send(server, token, request);
  }
  let last: { status: number; raw: unknown } = { status: 200, raw: undefined };
  // Each page is fetched raw: the cursor goes back to the server exactly as it
  // came, and `collectPages` escapes only the items it answers.
  const { items } = await collectPages(
    async (cursor) => {
      last = await sendRaw(server, token, pageOf(request, cursor));
      return last.raw;
    },
    {
      // The one list read by a field named only at runtime, so the one checked.
      items: (raw) => {
        try {
          return itemsOf(raw, paging.items);
        } catch (error) {
          throw new ZitadelError(
            "E_VALIDATION",
            error instanceof Error ? error.message : String(error),
            { details: { response: sanitizeResponse(raw) } },
          );
        }
      },
      all: true,
      next: nextToken,
    },
  );
  // The last page's other fields, escaped once, with every page's items in
  // place of its own and in its order.
  const page = isObject(last.raw) ? last.raw : {};
  return {
    status: last.status,
    body: Object.fromEntries(
      Object.entries(page).map(([field, value]) =>
        field === paging.items ? [field, items] : sanitizeResponse([field, value]),
      ),
    ),
  };
};
