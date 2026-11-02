import { ApiError, request as fetchWithPolicy } from "@zitadel/api/runtime/fetch";
import { Paging } from "@zitadel/api/runtime/paging";

import { REQUEST_TIMEOUT_MS, sanitizeRejection, sanitizeResponse } from "../api-client";
import { Consent } from "../consent";
import { ZitadelError, errorMessage } from "../errors";
import { isObject, parseJsonOrUndefined } from "../json";
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
  const parsed = parseJsonOrUndefined(raw);
  return parsed === undefined ? raw : parsed;
};

/**
 * Send one request to `server`, with the project secret as the bearer when
 * there is one. It is bounded, and cancelled when `signal` aborts, as every
 * platform call is (`createZitadelClient`), and what the server says is escaped the same way:
 * a non-2xx is the {@link ApiError} `toZitadelError` maps to an exit code.
 *
 * A destructive request (one whose operation the spec marks) is sent only with the
 * `consent` its command asked for, as the client's are.
 */
export const send = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
  signal: AbortSignal,
  consent?: Consent,
): Promise<ApiResponse> => {
  const { status, raw } = await sendRaw(server, token, request, signal, consent);
  return { status, body: sanitizeResponse(raw) };
};

/** A response as it came off the wire: its status, and its body not yet escaped. */
type RawResponse = Readonly<{ status: number; raw: unknown }>;

/**
 * {@link send}, answering the body as the server sent it; a failure is escaped
 * all the same. Every request goes out here, so a destructive one without
 * `consent` is refused here, whichever caller sent it.
 */
const sendRaw = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
  signal: AbortSignal,
  consent?: Consent,
): Promise<RawResponse> => {
  if (request.operation.destructive) {
    Consent.assert(consent);
  }
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
    { signal, timeoutMs: REQUEST_TIMEOUT_MS },
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
 * answer the last page with the page field holding every page's items.
 */
export const sendAll = async (
  server: string,
  token: string | undefined,
  request: ApiRequest,
  signal: AbortSignal,
): Promise<ApiResponse> => {
  const paging = request.operation.paging;
  if (paging === null) {
    return send(server, token, request, signal);
  }
  const fields = Paging.byField(paging.items);
  const responses = new Paging<RawResponse, unknown>({
    items: (response) => {
      try {
        return fields.items(response.raw);
      } catch (error) {
        throw new ZitadelError("E_VALIDATION", errorMessage(error), {
          details: { response: sanitizeResponse(response.raw) },
        });
      }
    },
    next: (response) => {
      return fields.next(response.raw);
    },
  });
  const walk = responses.walk(async (cursor) => {
    return sendRaw(server, token, pageOf(request, cursor), signal);
  });
  const { items, last } = await responses.collect(walk, { all: true });
  const page = isObject(last?.raw) ? last.raw : {};
  const body = sanitizeResponse({ ...page, [paging.items]: [] });
  return {
    status: last?.status ?? 200,
    body: { ...body, [paging.items]: sanitizeResponse(items) },
  };
};
