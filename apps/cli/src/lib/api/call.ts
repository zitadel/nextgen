import { ApiError, request as fetchWithPolicy } from "@zitadel/api/runtime/fetch";
import { itemsOf, pages } from "@zitadel/api/runtime/paging";

import { REQUEST_TIMEOUT_MS, sanitizeRejection, sanitizeResponse } from "../api-client";
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
  return { status: res.status, body: sanitizeResponse(rawBody) };
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
  let last: ApiResponse = { status: 200, body: undefined };
  const { items } = await collectPages(
    pages(
      async (cursor) => {
        last = await send(server, token, pageOf(request, cursor));
        return last.body;
      },
      {
        // The page the caller asked for, so a server that hands it back is refused.
        start:
          paging.token === "query"
            ? request.query.find(([name]) => name === "page_token")?.[1]
            : (request.body as { page_token?: string } | undefined)?.page_token,
      },
    ),
    {
      items: (body) => itemsOf(body, paging.items),
      all: true,
    },
  );
  return {
    status: last.status,
    body: { ...(last.body as Record<string, unknown>), [paging.items]: items },
  };
};
