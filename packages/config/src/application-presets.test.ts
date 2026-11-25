import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import applicationMetaSchema from "../meta-schemas/application.json" with { type: "json" };
import { webApplication } from "./application-presets.js";
import { applicationConfigSchema, declaredApplicationIssues } from "./schemas.js";

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

  it("leaves the client id and secret out for the server to issue", () => {
    expect(app.clients[0]).not.toHaveProperty("client_id");
    expect(app.clients[0]).not.toHaveProperty("secret");
  });

  it("builds a file a release declares, with the client id and secret variable it is given", () => {
    const declared = webApplication({
      slug: "shop",
      name: "Shop",
      redirectUris,
      declared: { clientId: "shop-web", secretVariable: "SHOP_WEB_CLIENT_SECRET" },
    });
    expect(declared.clients[0]?.client_id).toBe("shop-web");
    expect(declared.clients[0]?.secret).toBe("${{ SHOP_WEB_CLIENT_SECRET }}");
    expect(applicationConfigSchema.safeParse(declared).success).toBe(true);
    expect(declaredApplicationIssues(declared)).toEqual([]);
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
