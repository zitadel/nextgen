import { describe, expect, it } from "vitest";

import { SHARED_VARIABLE } from "@/lib/zitadel/rules/applications/shared-variable";
import { aConfig, anApplication, anOidcConnection } from "@tests/helpers/config";

describe("application/shared-variable", () => {
  it("refuses a client that names another client's secret variable, naming the first", () => {
    const store = { ...anApplication({ client_id: "store-web" }), slug: "store" };
    const config = aConfig({ applications: { "shop.json": anApplication(), "store.json": store } });

    expect(SHARED_VARIABLE.check(config, {})).toEqual([
      {
        severity: "error",
        rule: "application/shared-variable",
        file: ".zitadel/applications/store.json",
        message:
          'client "web" names the secret variable SHOP_WEB_CLIENT_SECRET, which client "web" of .zitadel/applications/shop.json also names. Give each client its own secret variable.',
      },
    ]);
  });

  it.each([
    ["client_secret", { client_secret: "${{ SHOP_WEB_CLIENT_SECRET }}" }],
    ["client_id", { client_id: "${{ SHOP_WEB_CLIENT_SECRET }}" }],
  ])("refuses a client whose secret variable a connection names as its %s", (field, oidc) => {
    const config = aConfig({
      applications: { "shop.json": anApplication() },
      connections: { "acme.json": anOidcConnection({ oidc }) },
    });

    expect(SHARED_VARIABLE.check(config, {})).toEqual([
      {
        severity: "error",
        rule: "application/shared-variable",
        file: ".zitadel/applications/shop.json",
        message: `client "web" names the secret variable SHOP_WEB_CLIENT_SECRET, which .zitadel/idps/acme.json also uses as its ${field}. Give each client its own secret variable.`,
      },
    ]);
  });

  it("finds nothing when every client and connection names its own variable", () => {
    const store = {
      ...anApplication({ client_id: "store-web", secret: "${{ STORE_SECRET }}" }),
      slug: "store",
    };
    const config = aConfig({
      applications: { "shop.json": anApplication(), "store.json": store },
      connections: { "acme.json": anOidcConnection() },
    });

    expect(SHARED_VARIABLE.check(config, {})).toEqual([]);
  });
});
