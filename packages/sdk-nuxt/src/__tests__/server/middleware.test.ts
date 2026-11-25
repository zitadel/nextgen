/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for Nuxt: this file is the glue between its cases and this SDK's handler.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { EventHandler, H3Event, H3EventContext } from "h3";

import { createApp, toWebHandler } from "h3";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import { createZitadelMiddleware, getAuth } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

// Each case starts from an app that sets no runtime config.
beforeEach(() => {
  setRuntimeConfig({ zitadel: {} });
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
  app.use(createZitadelMiddleware(options));
  let continued = false;
  let auth: AuthResult | undefined;
  app.use((event) => {
    continued = true;
    auth = event.context.zitadelAuth;
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
  setRuntimeConfig({ zitadel: { projectSecret: configured } });
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
  expectTypeOf(createZitadelMiddleware({ url: "http://localhost:4000" })).toExtend<EventHandler>();
  expectTypeOf<H3EventContext["zitadelAuth"]>().toEqualTypeOf<AuthResult | undefined>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});

describe("protected routes and encoded paths", () => {
  const options = {
    url: "http://localhost:4000",
    projectId: "project",
    protectedRoutes: ["/admin*"],
    loginPath: "/login",
  };

  it.each(["/admin", "/%61dmin", "/ad%6Din/x"])(
    "sends a signed-out visitor of %s to the login page",
    async (path) => {
      const served = await serve(`http://localhost:3000${path}`, {}, options);

      expect(served.status).toBe(302);
      expect(served.headers.get("location")).toContain("/login");
    },
  );
});

describe("an empty backend URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("counts as unset, so the proxy uses the next source", async () => {
    const requested: string[] = [];
    const backend = createServer((request, response) => {
      requested.push(request.url ?? "");
      response.end("{}");
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    vi.stubEnv("ZITADEL_URL", `http://127.0.0.1:${port}`);

    try {
      await serve("http://localhost:3000/__nextgen/ping", {}, { url: "" });
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(requested).not.toEqual([]);
  });
});
