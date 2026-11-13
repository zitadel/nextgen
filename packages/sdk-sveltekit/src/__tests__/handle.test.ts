/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for SvelteKit: this file is the glue between its cases and this SDK's handler.
 */

import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";

import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import { createNextgenHandle, getAuth } from "../handle";

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const jar = new Map<string, string>();
  for (const part of (init.headers?.cookie ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  // The `Set-Cookie` values SvelteKit adds to the response `resolve` produces.
  const written: string[] = [];
  const requestUrl = new URL(url);
  // What SvelteKit gives an attribute a call leaves out: Secure everywhere but
  // http://localhost.
  const withDefaults = (opts: CookieOptions): CookieOptions => ({
    httpOnly: true,
    sameSite: "lax",
    secure: !(requestUrl.hostname === "localhost" && requestUrl.protocol === "http:"),
    ...opts,
  });
  const event = {
    url: new URL(url),
    request: new Request(url, { method: init.method ?? "GET", headers: init.headers }),
    cookies: {
      get: (name: string) => jar.get(name),
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, opts: CookieOptions) => {
        jar.set(name, value);
        written.push(serializeCookie(name, value, withDefaults(opts)));
      },
      delete: (name: string, opts: CookieOptions) => {
        jar.delete(name);
        written.push(serializeCookie(name, "", { ...withDefaults(opts), maxAge: 0 }));
      },
    },
    locals: {} as Record<string, unknown>,
    getClientAddress: () => {
      if (!init.clientIp) throw new Error("Could not determine clientAddress");
      return init.clientIp;
    },
  } as unknown as RequestEvent;
  const resolve = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  const response = (await createNextgenHandle(options)({
    event,
    resolve,
  } as unknown as Parameters<Handle>[0])) as Response;
  const headers = new Headers(response.headers);
  for (const cookie of written) {
    headers.append("set-cookie", cookie);
  }
  return {
    answered: resolve.mock.calls.length === 0,
    status: response.status,
    headers,
    auth: event.locals.nextgenAuth as AuthResult | undefined,
    body: await response.text(),
  };
}

/** The options `event.cookies.set` and `delete` take. */
interface CookieOptions {
  readonly path: string;
  readonly httpOnly?: boolean;
  readonly sameSite?: string;
  readonly secure?: boolean;
  readonly maxAge?: number;
  readonly encode?: (value: string) => string;
}

/** The `Set-Cookie` value SvelteKit writes for `event.cookies.set(name, value, opts)`. */
function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const attributes = [`${name}=${(opts.encode ?? encodeURIComponent)(value)}`, `Path=${opts.path}`];
  if (opts.maxAge !== undefined) attributes.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) attributes.push("HttpOnly");
  if (opts.sameSite) attributes.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) attributes.push("Secure");
  return attributes.join("; ");
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
  return getAuth({ locals: context ?? {} } as unknown as RequestEvent);
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenHandle({ url: "http://localhost:4000" })).toExtend<Handle>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});
