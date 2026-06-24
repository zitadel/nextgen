import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { buildOpenIdConfiguration } from "@zitadel/api-mock/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app, createApp } from "./app.js";
import { resolveIssuer } from "./issuer.js";

describe("resolveIssuer", () => {
  it("uses the per-deployment VERCEL_URL over HTTPS when present", () => {
    expect(resolveIssuer({ VERCEL_URL: "pr-123.vercel.app" })).toBe("https://pr-123.vercel.app");
  });

  it("falls back to a localhost issuer on the configured PORT", () => {
    expect(resolveIssuer({ PORT: "9999" })).toBe("http://localhost:9999");
  });

  it("defaults the localhost port to 8080 when PORT is unset", () => {
    expect(resolveIssuer({})).toBe("http://localhost:8080");
  });
});

describe("static discovery document", () => {
  // Vercel reserves `/.well-known/*` from rewrites, so the discovery doc
  // is emitted as a static asset at build time. It must point `jwks_uri`
  // at a non-reserved path the rewrite still reaches, or JWKS lookups
  // 404 on the preview.
  it("points jwks_uri at /auth/keys, off the reserved /.well-known path", () => {
    const issuer = "https://pr-123.vercel.app";
    const doc = buildOpenIdConfiguration(issuer, { jwksUri: `${issuer}/auth/keys` });
    expect(doc.issuer).toBe(issuer);
    expect(doc.jwks_uri).toBe("https://pr-123.vercel.app/auth/keys");
    expect(doc.jwks_uri).not.toContain("/.well-known/");
  });
});

describe("app", () => {
  // The issuer is decoupled from the bind address (on Vercel it is the
  // deployment URL, not the listen port), so inject a known issuer via the
  // factory and assert the discovery document reflects exactly that —
  // rather than spinning up the ambient-env singleton and loosely matching.
  const issuer = "https://test-issuer.example";
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp({ issuer }).listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("exposes a default app built from the ambient environment", () => {
    expect(typeof app).toBe("function");
  });

  it("serves the OIDC discovery document with the injected issuer", async () => {
    const response = await fetch(`${baseUrl}/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issuer: string; jwks_uri: string };
    expect(body.issuer).toBe(issuer);
    expect(body.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
  });

  it("serves a JWKS with one signing key", async () => {
    const response = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: unknown[] };
    expect(body.keys).toHaveLength(1);
  });

  it("handles a platform route end to end (create project)", async () => {
    const response = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo" }),
    });
    expect(response.status).toBe(201);
  });
});
