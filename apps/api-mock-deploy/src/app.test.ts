import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app, resolveIssuer } from "./app.js";

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

describe("app", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("serves the OIDC discovery document", async () => {
    const response = await fetch(`${baseUrl}/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issuer: string; jwks_uri: string };
    expect(body.issuer).toMatch(/^https?:\/\//);
    expect(body.jwks_uri).toBe(`${body.issuer}/.well-known/jwks.json`);
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
