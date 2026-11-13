/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for SolidStart: this file is the glue between its cases and this SDK's handler.
 */

import type { createMiddleware } from "@solidjs/start/middleware";

import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import type { SolidFetchEvent } from "../middleware";

import { createNextgenMiddleware, getAuth } from "../middleware";

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const event: SolidFetchEvent = {
    request: new Request(url, { method: init.method ?? "GET", headers: init.headers }),
    locals: {},
    clientAddress: init.clientIp,
    response: { headers: new Headers() },
  };
  const response = await createNextgenMiddleware(options).onRequest[0]!(event);
  const headers = new Headers(response?.headers);
  // SolidStart merges the response stub's headers into the page it sends.
  if (!response) {
    for (const [name, value] of event.response?.headers ?? []) {
      if (name !== "set-cookie") headers.set(name, value);
    }
  }
  for (const cookie of event.response?.headers.getSetCookie() ?? []) {
    headers.append("set-cookie", cookie);
  }
  return {
    answered: response !== undefined,
    status: response?.status ?? 200,
    headers,
    auth: event.locals.nextgenAuth,
    inbound: event.request.headers,
    body: (await response?.text()) ?? "",
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
  return getAuth({
    request: new Request("http://localhost:3000/"),
    locals: (context ?? {}) as SolidFetchEvent["locals"],
  });
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenMiddleware({ url: "http://localhost:4000" })).toExtend<
    Parameters<typeof createMiddleware>[0]
  >();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});
