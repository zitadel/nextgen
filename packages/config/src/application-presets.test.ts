import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import applicationMetaSchema from "../meta-schemas/application.json" with { type: "json" };
import { webApplication } from "./application-presets.js";

const validate = new Ajv2020({ strict: false }).compile(applicationMetaSchema);

describe("web application preset", () => {
  const redirectUris = ["https://shop.example.com/callback", "http://localhost:3000/callback"];
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
});
