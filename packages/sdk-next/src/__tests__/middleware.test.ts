/**
 * The server middleware contract (`@zitadel/framework-contract/middleware`)
 * for Next.js: this file is the glue between its cases and this SDK's handler.
 */

import { NextRequest } from "next/server";

import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/framework-contract/middleware";

import { describeServerMiddleware } from "@zitadel/framework-contract/middleware";

import { nextgenMiddleware } from "../middleware";

const mockHeaders = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: (name: string) => mockHeaders.get(name) ?? null })),
}));

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const request = new NextRequest(url, {
    method: init.method ?? "GET",
    headers: init.headers,
  });
  // Next 15 exposes the runtime-provided address as `request.ip`; a header never stands in for it.
  Object.defineProperty(request, "ip", { value: init.clientIp });
  const response = await nextgenMiddleware(request, options);
  const continued = response.headers.has("x-middleware-next");
  // Next.js hands server components the request headers with the middleware's overrides applied.
  const inbound = new Headers(request.headers);
  for (const [name, value] of response.headers) {
    if (name.startsWith("x-middleware-request-")) {
      inbound.set(name.slice("x-middleware-request-".length), value);
    }
  }
  // A server component reads the session with auth(), which checks the token
  // the middleware handed on: off a protected route, an opaque one unchecked.
  const auth = continued
    ? await readAuth({ "x-nextgen-auth-token": inbound.get("x-nextgen-auth-token") ?? "" }, options)
    : undefined;
  return {
    answered: !continued,
    status: response.status,
    headers: response.headers,
    auth,
    body: await response.text(),
  };
}

// Next reads the project secret from one source, `ZITADEL_PROJECT_SECRET`, and
// takes no option for it, so the contract's "configuration" row repeats its
// "environment" row here.
function configureSecret(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_SECRET", configured ?? environment);
  return {};
}

function configureProject(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_ID", environment);
  vi.stubEnv("NEXT_PUBLIC_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown, options: ServeOptions = {}): Promise<AuthResult> {
  mockHeaders.clear();
  for (const [name, value] of Object.entries((context ?? {}) as Record<string, string>)) {
    mockHeaders.set(name, value);
  }
  const { auth } = await import("../auth.js");
  return auth(options);
}

function expectHandlerType(): void {
  expectTypeOf(nextgenMiddleware).toExtend<(request: NextRequest) => Promise<Response>>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: false,
});
