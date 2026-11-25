/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for TanStack Start: this file is the glue between its cases and this SDK's handler.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import type { RequestMiddlewareContext } from "../middleware";

import { createZitadelRequestMiddleware, getAuth } from "../middleware";

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const request = new Request(url, { method: init.method ?? "GET", headers: init.headers });
  let continued = false;
  let auth: AuthResult | undefined;
  const response = await createZitadelRequestMiddleware({
    ...options,
    clientAddress: init.clientIp,
  })({
    request,
    next: async (opts) => {
      continued = true;
      auth = opts?.context?.zitadelAuth as AuthResult | undefined;
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
  return getAuth(context as { readonly zitadelAuth?: AuthResult } | undefined);
}

function expectHandlerType(): void {
  expectTypeOf(createZitadelRequestMiddleware({ url: "http://localhost:4000" })).toExtend<
    (ctx: RequestMiddlewareContext) => Promise<Response>
  >();
  // TanStack Start types next() as returning its result with or without a promise.
  expectTypeOf(createZitadelRequestMiddleware({ url: "http://localhost:4000" })).toBeCallableWith({
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
