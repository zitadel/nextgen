/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for Next.js: this file is the glue between its cases and this SDK's handler.
 */

import { NextRequest } from "next/server";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import { zitadelMiddleware } from "../middleware";

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
  const response = await zitadelMiddleware(request, options);
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
    ? await readAuth({ "x-zitadel-auth-token": inbound.get("x-zitadel-auth-token") ?? "" }, options)
    : undefined;
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
  expectTypeOf(zitadelMiddleware).toExtend<(request: NextRequest) => Promise<Response>>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: false,
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
    vi.unstubAllGlobals();
  });

  it("counts as unset, so the proxy calls the default backend", async () => {
    const requested: string[] = [];
    vi.stubEnv("ZITADEL_URL", "");
    vi.stubGlobal("fetch", async (input: string | URL | Request): Promise<Response> => {
      requested.push(String(input));
      return new Response("{}", { status: 200 });
    });

    await serve("http://localhost:3000/__nextgen/ping");

    expect(requested[0]).toMatch(/^http:\/\/localhost:8080/);
  });
});
