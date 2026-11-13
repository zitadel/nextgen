/**
 * The server middleware contract (`@zitadel/framework-contract/middleware`)
 * for Nuxt: this file is the glue between its cases and this SDK's handler.
 */

import type { EventHandler, H3Event, H3EventContext } from "h3";

import { createApp, toWebHandler } from "h3";
import { beforeEach, expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/framework-contract/middleware";

import { describeServerMiddleware } from "@zitadel/framework-contract/middleware";

import { createNextgenMiddleware, getAuth } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

// Each case starts from an app that sets no runtime config.
beforeEach(() => {
  setRuntimeConfig({ nextgen: {} });
});

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
  app.use((event) => {
    continued = true;
    auth = event.context.nextgenAuth;
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
    body: await response.text(),
  };
}

function configureSecret(configured?: string, environment?: string): ServeOptions {
  setRuntimeConfig({ nextgen: { projectSecret: configured } });
  vi.stubEnv("ZITADEL_PROJECT_SECRET", environment);
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
  checksSessionsOnPublicRoutes: true,
});
