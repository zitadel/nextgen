/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for Nuxt: this file is the glue between its cases and this SDK's handler.
 */

import type { EventHandler, H3Event, H3EventContext } from "h3";

import { createApp, toWebHandler } from "h3";
import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import { createNextgenMiddleware, getAuth } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

function resetSdk(): void {
  setRuntimeConfig({ nextgen: {} });
}

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const app = createApp();
  if (init.clientIp) {
    app.use((event) => {
      (event.node.req as unknown as { socket: { remoteAddress?: string } }).socket = {
        remoteAddress: init.clientIp,
      };
    });
  }
  app.use(createNextgenMiddleware(options));
  let continued = false;
  let auth: AuthResult | undefined;
  let inbound = new Headers();
  app.use((event) => {
    continued = true;
    auth = event.context.nextgenAuth;
    inbound = new Headers(event.node.req.headers as Record<string, string>);
    return { ok: true };
  });
  const response = await toWebHandler(app)(
    new Request(url, {
      method: init.method ?? "GET",
      headers: { host: new URL(url).host, ...init.headers },
    }),
  );
  return {
    answered: !continued,
    status: response.status,
    headers: response.headers,
    auth,
    inbound,
    body: await response.text(),
  };
}

function configureSecret(configured?: string, environment?: string): ServeOptions {
  setRuntimeConfig({ nextgen: { projectSecret: configured ?? environment } });
  return {};
}

function configureProject(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_ID", environment);
  vi.stubEnv("NUXT_PUBLIC_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown): Promise<AuthResult> {
  return getAuth({ context: context ?? {} } as unknown as H3Event);
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenMiddleware({ url: "http://localhost:4000" })).toExtend<EventHandler>();
  expectTypeOf<H3EventContext["nextgenAuth"]>().toEqualTypeOf<AuthResult | undefined>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  resetSdk,
  checksSessionsOnPublicRoutes: true,
});
