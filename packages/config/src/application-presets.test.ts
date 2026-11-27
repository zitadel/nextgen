import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import applicationMetaSchema from "../meta-schemas/application.json" with { type: "json" };
import { nativeApplication, spaApplication, webApplication } from "./application-presets.js";

const validate = new Ajv2020({ strict: false }).compile(applicationMetaSchema);

describe("web application preset", () => {
  const redirectUris: [string, ...string[]] = [
    "https://shop.example.com/callback",
    "http://localhost:3000/callback",
  ];
  const app = webApplication({ slug: "shop", name: "Shop", redirectUris });

  it("builds a document the application schema accepts", () => {
    expect(validate(app), JSON.stringify(validate.errors)).toBe(true);
  });

  it("is refused by the schema once a key it does not declare is added", () => {
    const withBogusKey = { ...app, clients: [{ ...app.clients[0], bogus_key: "x" }] };
    expect(validate(withBogusKey)).toBe(false);
  });

  it("has one confidential client using the authorization code grant", () => {
    expect(app.clients).toHaveLength(1);
    expect(app.clients[0]?.type).toBe("confidential");
    expect(app.clients[0]?.grant_types).toEqual(["authorization_code"]);
  });

  it("keeps the slug, name and redirect URIs it is given", () => {
    expect(app.slug).toBe("shop");
    expect(app.name).toBe("Shop");
    expect(app.clients[0]?.redirect_uris).toEqual(redirectUris);
    expect(app.clients[0]?.redirect_uris).not.toBe(redirectUris);
  });

  it("drops duplicate redirect URIs and keeps their order", () => {
    const first = "https://shop.example.com/callback";
    const second = "http://localhost:3000/callback";
    const deduped = webApplication({
      slug: "shop",
      name: "Shop",
      redirectUris: [first, second, first],
    });
    expect(deduped.clients[0]?.redirect_uris).toEqual([first, second]);
  });
});

describe("spa application preset", () => {
  const redirectUris: [string, ...string[]] = ["http://localhost:5173/callback"];
  const allowedOrigins: [string, ...string[]] = ["http://localhost:5173"];
  const app = spaApplication({ slug: "boards", name: "Boards", redirectUris, allowedOrigins });

  it("builds a document the application schema accepts", () => {
    expect(validate(app), JSON.stringify(validate.errors)).toBe(true);
  });

  it("has one public client with PKCE grants and allowed origins", () => {
    expect(app.clients).toHaveLength(1);
    expect(app.clients[0]?.slug).toBe("spa");
    expect(app.clients[0]?.type).toBe("public");
    expect(app.clients[0]?.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(app.clients[0]?.allowed_origins).toEqual(allowedOrigins);
  });

  it("drops duplicate origins and redirect URIs", () => {
    const deduped = spaApplication({
      slug: "boards",
      name: "Boards",
      redirectUris: ["http://localhost:5173/callback", "http://localhost:5173/callback"],
      allowedOrigins: ["http://localhost:5173", "http://localhost:5173"],
    });
    expect(deduped.clients[0]?.redirect_uris).toEqual(["http://localhost:5173/callback"]);
    expect(deduped.clients[0]?.allowed_origins).toEqual(["http://localhost:5173"]);
  });
});

describe("native application preset", () => {
  const redirectUris: [string, ...string[]] = ["com.acme.tunes:/callback", "http://127.0.0.1/callback"];
  const app = nativeApplication({ slug: "tunes", name: "Acme Tunes", redirectUris });

  it("builds a document the application schema accepts", () => {
    expect(validate(app), JSON.stringify(validate.errors)).toBe(true);
  });

  it("has one public client without allowed origins", () => {
    expect(app.clients).toHaveLength(1);
    expect(app.clients[0]?.slug).toBe("native");
    expect(app.clients[0]?.type).toBe("public");
    expect(app.clients[0]?.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(app.clients[0]?.allowed_origins).toBeUndefined();
    expect(app.clients[0]?.redirect_uris).toEqual(redirectUris);
  });
});
