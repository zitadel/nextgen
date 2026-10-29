import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import { developerAccessToken, signIn, toStoredLogin } from "../../../../src/lib/login/flow";
import { credentialsPath, readLogin, writeLogin } from "../../../../src/lib/login/store";

/** What the fake authorization server saw, for the assertions. */
type Seen = {
  authorize?: URLSearchParams;
  tokenRequests: URLSearchParams[];
};

/**
 * A fake of the platform's authorization server: its discovery documents, an
 * authorize endpoint that signs the "browser" straight in and redirects with a
 * code, and a token endpoint that checks what the real one checks: PKCE, the
 * redirect URI and the client, and rotates refresh tokens.
 */
async function fakeAuthorizationServer(
  options: { issuerOverride?: string; deny?: boolean } = {},
): Promise<{ origin: string; seen: Seen; close: () => Promise<void> }> {
  const seen: Seen = { tokenRequests: [] };
  let origin = "";
  let refreshCount = 0;
  const spentRefreshTokens = new Set<string>();
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    };
    const issuer = `${origin}/oauth/proj_platform`;
    switch (url.pathname) {
      case "/.well-known/oauth-protected-resource":
        return json(200, { resource: origin, authorization_servers: [issuer] });
      case "/.well-known/oauth-authorization-server/oauth/proj_platform":
        return json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          revocation_endpoint: `${issuer}/revoke`,
          code_challenge_methods_supported: ["S256"],
        });
      case "/oauth/proj_platform/authorize": {
        seen.authorize = url.searchParams;
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        if (options.deny) {
          back.searchParams.set("error", "access_denied");
        } else {
          back.searchParams.set("code", "the-code");
        }
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        back.searchParams.set("iss", options.issuerOverride ?? issuer);
        response.writeHead(303, { Location: back.toString() }).end();
        return;
      }
      case "/oauth/proj_platform/token": {
        const form = new URLSearchParams(await body(request));
        seen.tokenRequests.push(form);
        if (form.get("grant_type") === "refresh_token") {
          const presented = form.get("refresh_token") ?? "";
          if (spentRefreshTokens.has(presented)) {
            return json(400, { error: "invalid_grant", error_description: "already used" });
          }
          spentRefreshTokens.add(presented);
          refreshCount += 1;
          return json(200, {
            access_token: `access-${refreshCount}`,
            token_type: "Bearer",
            expires_in: 300,
            refresh_token: `refresh-${refreshCount}`,
          });
        }
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          form.get("code") !== "the-code" ||
          challenge !== seen.authorize?.get("code_challenge") ||
          form.get("redirect_uri") !== seen.authorize?.get("redirect_uri") ||
          form.get("client_id") !== "cli"
        ) {
          return json(400, { error: "invalid_grant" });
        }
        return json(200, {
          access_token: "access-0",
          token_type: "Bearer",
          expires_in: 300,
          refresh_token: "refresh-0",
        });
      }
      default:
        response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => resolve(data));
  });
}

/** The browser: it follows the authorization server's redirect to the loopback. */
async function browser(authorizationUrl: string): Promise<void> {
  const authorize = await fetch(authorizationUrl, { redirect: "manual" });
  const location = authorize.headers.get("location");
  if (location !== null) {
    await fetch(location);
  }
}

describe("signIn", () => {
  let as: Awaited<ReturnType<typeof fakeAuthorizationServer>>;
  afterEach(async () => {
    await as.close();
  });

  it("returns the tokens of a code exchanged with PKCE on a loopback redirect", async () => {
    as = await fakeAuthorizationServer();

    const tokens = await signIn({ server: as.origin, present: browser, timeoutMs: 5000 });

    expect(tokens.accessToken).toBe("access-0");
    expect(tokens.refreshToken).toBe("refresh-0");
    expect(tokens.authorization.resource).toBe(as.origin);
  });

  it("asks for a code with an S256 challenge, a state and the platform API as resource", async () => {
    as = await fakeAuthorizationServer();

    await signIn({ server: as.origin, present: browser, timeoutMs: 5000 });

    expect(as.seen.authorize?.get("client_id")).toBe("cli");
    expect(as.seen.authorize?.get("code_challenge_method")).toBe("S256");
    expect(as.seen.authorize?.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(as.seen.authorize?.get("state")).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(as.seen.authorize?.get("resource")).toBe(as.origin);
  });

  it("listens on a loopback IP literal on a free port", async () => {
    as = await fakeAuthorizationServer();

    await signIn({ server: as.origin, present: browser, timeoutMs: 5000 });

    expect(as.seen.authorize?.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it("refuses an answer that names another issuer (RFC 9207)", async () => {
    as = await fakeAuthorizationServer({ issuerOverride: "https://evil.example/oauth/x" });

    const run = signIn({ server: as.origin, present: browser, timeoutMs: 5000 });

    await expect(run).rejects.toMatchObject({ code: "E_AUTH" });
    expect(as.seen.tokenRequests).toEqual([]);
  });

  it("fails naming the error when the person denies the request", async () => {
    as = await fakeAuthorizationServer({ deny: true });

    const run = signIn({ server: as.origin, present: browser, timeoutMs: 5000 });

    await expect(run).rejects.toThrow(/access_denied/);
  });

  it("ignores a callback that carries another state", async () => {
    as = await fakeAuthorizationServer();
    const forged = async (url: string) => {
      const redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
      await fetch(`${redirect}?code=forged&state=not-this-run`);
    };

    const run = signIn({ server: as.origin, present: forged, timeoutMs: 300 });

    await expect(run).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("developerAccessToken", () => {
  let as: Awaited<ReturnType<typeof fakeAuthorizationServer>>;
  let config: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    as = await fakeAuthorizationServer();
    config = await mkdtemp(join(tmpdir(), "zitadel-login-"));
    env = { XDG_CONFIG_HOME: config };
  });
  afterEach(async () => {
    await as.close();
    await rm(config, { recursive: true, force: true });
  });

  async function signedIn(expiresAt: Date): Promise<void> {
    const tokens = await signIn({ server: as.origin, present: browser, timeoutMs: 5000 });
    await writeLogin(
      as.origin,
      toStoredLogin({ ...tokens, accessTokenExpiresAt: expiresAt }, { id: "user_dev" }, new Date()),
      env,
    );
  }

  it("is undefined when nobody signed in", async () => {
    expect(await developerAccessToken(as.origin, env)).toBeUndefined();
  });

  it("returns the stored access token while it lives", async () => {
    await signedIn(new Date(Date.now() + 60_000));

    const got = await developerAccessToken(as.origin, env);

    expect(got?.token).toBe("access-0");
    expect(as.seen.tokenRequests).toHaveLength(1);
  });

  it("refreshes an expired one and stores the rotated refresh token", async () => {
    await signedIn(new Date(Date.now() - 1000));

    const got = await developerAccessToken(as.origin, env);

    expect(got?.token).toBe("access-1");
    expect((await readLogin(as.origin, env))?.refresh_token).toBe("refresh-1");
  });

  it("forgets a sign-in whose refresh is refused, and asks for a new one", async () => {
    await signedIn(new Date(Date.now() - 1000));
    const stored = await readLogin(as.origin, env);
    await developerAccessToken(as.origin, env);
    await writeLogin(
      as.origin,
      {
        ...(stored as NonNullable<typeof stored>),
        access_token_expires_at: new Date(0).toISOString(),
      },
      env,
    );

    const run = developerAccessToken(as.origin, env);

    await expect(run).rejects.toBeInstanceOf(ZitadelError);
    await expect(run).rejects.toMatchObject({ code: "E_AUTH" });
    expect(await readLogin(as.origin, env)).toBeUndefined();
  });
});

describe("the credentials file", () => {
  it("is readable and writable by its owner alone, in a directory only the owner can enter", async () => {
    const config = await mkdtemp(join(tmpdir(), "zitadel-login-"));
    const env = { XDG_CONFIG_HOME: config };
    const login = {
      issuer: "https://z.example/oauth/proj_platform",
      client_id: "cli",
      resource: "https://z.example",
      token_endpoint: "https://z.example/oauth/proj_platform/token",
      access_token: "a",
      access_token_expires_at: new Date().toISOString(),
      user: { id: "user_dev" },
      signed_in_at: new Date().toISOString(),
    };

    await writeLogin("https://z.example", login, env);

    const path = credentialsPath(env);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8")).servers["https://z.example"].access_token).toBe(
      "a",
    );
    await rm(config, { recursive: true, force: true });
  });
});
