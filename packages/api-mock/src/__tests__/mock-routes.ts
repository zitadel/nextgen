/**
 * The mock's routes, read off the handlers themselves, and a `fetch` that
 * validates every answer against the contract and records it, so the
 * conformance spec can prove each route was exercised.
 *
 * A route is served on one of two transports:
 *
 * - `server`: the Express app (`createMockApp`), which answers its own routes
 *   first and hands the rest to the MSW handlers.
 * - `in-process`: an MSW handler that an Express route shadows on the server,
 *   so only a `setupServer(...)` caller (the component, SDK and CLI tests)
 *   ever reaches it.
 */
import type express from "express";
import { HttpHandler, type RequestHandler } from "msw";

import { mountedHandlers } from "../server.js";
import { findOperation, specPath, templateKey, violations } from "./spec-contract.js";

export type Transport = "server" | "in-process";

export type MockRoute = {
  transport: Transport;
  method: string;
  /** The path as the handler declares it, without MSW's `*` or the API prefix. */
  path: string;
};

/** `METHOD /path`, the path's parameters unnamed: the key routes and requests meet on. */
export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${templateKey(path)}`;
}

type ExpressLayer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
};

function expressRoutes(app: express.Express): MockRoute[] {
  // Express 4 keeps its router at `_router`; Express 5 moved it to `router`.
  const router = (app as unknown as { _router?: { stack?: ExpressLayer[] } })._router;
  if (!router?.stack) {
    throw new Error(
      "the Express app has no _router.stack: read the routes the way this Express version keeps them",
    );
  }
  return router.stack.flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    const paths = [
      ...new Set((Array.isArray(route.path) ? route.path : [route.path]).map(specPath)),
    ];
    return Object.keys(route.methods).flatMap((method) =>
      paths.map((path) => ({ transport: "server" as const, method: method.toUpperCase(), path })),
    );
  });
}

function mswRoutes(handlers: readonly RequestHandler[]): Omit<MockRoute, "transport">[] {
  return handlers.map((handler) => {
    if (!(handler instanceof HttpHandler)) {
      throw new Error(
        `${handler.info.header} is not an HttpHandler: the check cannot read its route`,
      );
    }
    const { method, path } = handler.info;
    if (typeof method !== "string" || typeof path !== "string") {
      throw new Error(`a handler matches by ${String(path)}: give it a path the check can read`);
    }
    return { method, path: specPath(path.replace(/^\*/, "")) };
  });
}

/** Every route the mock serves, on the transport that reaches it. */
export function mockRoutes(app: express.Express): MockRoute[] {
  const server = expressRoutes(app);
  const shadowed = new Set(server.map((r) => routeKey(r.method, r.path)));
  const msw = mswRoutes(mountedHandlers({ iss: "http://localhost" })).map((route) => ({
    ...route,
    transport: shadowed.has(routeKey(route.method, route.path))
      ? ("in-process" as const)
      : ("server" as const),
  }));
  return [...server, ...msw];
}

/** One validated answer, as the coverage gate counts it. */
export type Observation = {
  transport: Transport;
  key: string;
  status: number;
};

/** The host in-process requests go to, so no MSW handler answers a request meant for the server. */
export const IN_PROCESS_ORIGIN = "http://in-process.test";

/** Every answer `conformantFetch` validated in this file's run; nothing else counts. */
export const observations: Observation[] = [];

/**
 * `fetch`, but every answer to a spec operation is checked against the
 * contract: a violation throws, naming the request and what the spec says.
 * Calls `globalThis.fetch` per request so an MSW `setupServer` installed later
 * still intercepts.
 */
export async function conformantFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const response = await globalThis.fetch(input, init);
  const url = new URL(request.url);
  const op = findOperation(request.method, url.pathname);
  if (!op || response.redirected) return response;
  const problems = violations(op, {
    status: response.status,
    contentType: response.headers.get("content-type"),
    text: await response.clone().text(),
  });
  if (problems.length > 0) {
    throw new Error(`the mock's answer breaks the contract:\n  ${problems.join("\n  ")}`);
  }
  observations.push({
    transport: url.origin === IN_PROCESS_ORIGIN ? "in-process" : "server",
    key: routeKey(op.method, op.path),
    status: response.status,
  });
  return response;
}
