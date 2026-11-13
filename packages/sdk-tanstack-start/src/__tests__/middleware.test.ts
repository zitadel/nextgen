/**
 * The server middleware contract (`@zitadel/framework-contract/middleware`)
 * for TanStack Start: this file is the glue between its cases and this SDK's handler.
 */

import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/framework-contract/middleware";

import { describeServerMiddleware } from "@zitadel/framework-contract/middleware";

import type { RequestMiddlewareContext } from "../middleware";

import { createNextgenRequestMiddleware, getAuth } from "../middleware";

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const request = new Request(url, { method: init.method ?? "GET", headers: init.headers });
  let continued = false;
  let auth: AuthResult | undefined;
  const response = await createNextgenRequestMiddleware({
    ...options,
    clientAddress: init.clientIp,
  })({
    request,
    next: async (opts) => {
      continued = true;
      auth = opts?.context?.nextgenAuth as AuthResult | undefined;
      return { response: new Response("ok", { status: 200 }) };
    },
  });
  return {
    answered: !continued,
    status: response.status,
    headers: response.headers,
    auth,
    body: await response.text(),
  };
}

function configureSecret(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_SECRET", environment);
  return { projectSecret: configured };
}

function configureProject(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_ID", environment);
  vi.stubEnv("VITE_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown): Promise<AuthResult> {
  return getAuth(context as { readonly nextgenAuth?: AuthResult } | undefined);
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenRequestMiddleware({ url: "http://localhost:4000" })).toExtend<
    (ctx: RequestMiddlewareContext) => Promise<Response>
  >();
  // TanStack Start types next() as returning its result with or without a promise.
  expectTypeOf(createNextgenRequestMiddleware({ url: "http://localhost:4000" })).toBeCallableWith({
    request: new Request("http://localhost:3000/"),
    next: () => ({ response: new Response("ok") }),
  });
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});
