import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { metaSchemaFiles } from "../meta-schemas.js";
import {
  APP_PRESETS,
  appClientSecretVariable,
  appPresetNeeds,
  composeAppDocument,
  isAppPreset,
} from "./presets.js";

/** The app meta-schema with the per-config schemas it `$ref`s, as an editor loads them. */
function appValidator() {
  const ajv = new Ajv2020({ strict: false });
  for (const file of metaSchemaFiles()) {
    if (file.name.startsWith("app")) ajv.addSchema(file.body as object, file.name);
  }
  const check = ajv.getSchema("app.json");
  if (!check) throw new Error("app.json is not materialized");
  return check;
}

describe("app presets", () => {
  const check = appValidator();
  const input = {
    slug: "shop",
    redirectUris: ["https://shop.example.com/callback"],
    identifier: "https://api.shop.example.com",
    scopes: ["orders.read"],
  };

  it.each(APP_PRESETS)("%s composes a document the app schema accepts", (id) => {
    const { document, missing } = composeAppDocument(id, input);
    expect(missing).toEqual([]);
    expect(check(document), JSON.stringify(check.errors)).toBe(true);
    expect(document.preset).toBe(id);
  });

  it("reports what a preset needs instead of composing a document the server refuses", () => {
    expect(composeAppDocument("web", { slug: "shop" }).missing).toEqual(["redirect_uris"]);
    expect(composeAppDocument("mcp-server", { slug: "shop" }).missing).toEqual(["identifier"]);
    expect(appPresetNeeds("cli")).toEqual([]);
  });

  it("names a declared client's secret after the app and the client", () => {
    expect(appClientSecretVariable("shop", "web")).toBe("SHOP_WEB_CLIENT_SECRET");
    expect(appClientSecretVariable("my-shop", "web")).toBe("MY_SHOP_WEB_CLIENT_SECRET");
    const web = composeAppDocument("web", input).document.clients?.[0];
    expect(web?.secret).toBe("${{ SHOP_WEB_CLIENT_SECRET }}");
  });

  it("opens an MCP server to registered clients through its API only", () => {
    const { document } = composeAppDocument("mcp-server", input);
    expect(document.apis?.[0]).toMatchObject({ third_party: true });
    expect(document.registration).toEqual({ client_id_metadata_documents: true });
  });

  it("knows its own ids", () => {
    expect(isAppPreset("web")).toBe(true);
    expect(isAppPreset("project")).toBe(false);
  });
});
