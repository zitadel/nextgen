/**
 * The server middleware contract (`@zitadel/framework-contract/middleware`)
 * for Qwik Router: this file is the glue between its cases and this SDK's handler.
 */

import type { RequestHandler } from "@qwik.dev/router";

import { expectTypeOf, vi } from "vitest";

import type { AuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/framework-contract/middleware";

import { describeServerMiddleware } from "@zitadel/framework-contract/middleware";

import type { QwikCookieOptions, QwikRequestEvent } from "../request-handler";

import { createNextgenOnRequest, getAuth } from "../request-handler";

class RedirectMarker {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    this.status = status;
    this.url = url;
  }
}

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
  // The `Set-Cookie` values Qwik adds to whichever response goes out.
  const written: string[] = [];
  let sent: Response | undefined;
  let redirected: { status: number; url: string } | undefined;
  // The headers of the response Qwik sends when the handler sends none itself.
  const responseHeaders = new Headers();
  const ev: QwikRequestEvent = {
    request: new Request(url, { method: init.method ?? "GET", headers: init.headers }),
    url: new URL(url),
    sharedMap: new Map<string, unknown>(),
    clientConn: { ip: init.clientIp },
    cookie: {
      get: (name) => (jar.has(name) ? { value: jar.get(name)! } : null),
      getAll: () => Object.fromEntries([...jar.entries()].map(([n, v]) => [n, { value: v }])),
      set: (name, value, opts) => {
        jar.set(name, value);
        written.push(serializeCookie(name, value, opts ?? {}));
      },
      delete: (name, opts) => {
        jar.delete(name);
        written.push(`${name}=; Path=${opts?.path ?? "/"}; Max-Age=0`);
      },
    },
    headers: responseHeaders,
    send: (response) => {
      sent = response;
    },
    redirect: (status, location) => {
      redirected = { status, url: location };
      return new RedirectMarker(status, location);
    },
  };
  try {
    await createNextgenOnRequest(options)(ev);
  } catch (err) {
    if (!(err instanceof RedirectMarker)) throw err;
  }
  const headers = new Headers(sent?.headers ?? responseHeaders);
  if (redirected) headers.set("location", redirected.url);
  for (const cookie of written) {
    headers.append("set-cookie", cookie);
  }
  return {
    answered: sent !== undefined || redirected !== undefined,
    status: sent?.status ?? redirected?.status ?? 200,
    headers,
    auth: ev.sharedMap.get("nextgenAuth") as AuthResult | undefined,
    body: (await sent?.text()) ?? "",
  };
}

/** The `Set-Cookie` value Qwik writes for `ev.cookie.set(name, value, opts)`. */
function serializeCookie(name: string, value: string, opts: QwikCookieOptions): string {
  const attributes = [`${name}=${value}`];
  if (opts.path) attributes.push(`Path=${opts.path}`);
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
  vi.stubEnv("PUBLIC_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown): Promise<AuthResult> {
  return getAuth({ sharedMap: new Map(Object.entries(context ?? {})) });
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenOnRequest({ url: "http://localhost:4000" })).toExtend<RequestHandler>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});
