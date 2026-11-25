import { describe, expect, it } from "vitest";

import { SHARED_VARIABLE } from "@/lib/zitadel/rules/applications/shared-variable";
import { aConfig, anApplication } from "@tests/helpers/config";

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
          'client "web" names the secret variable SHOP_WEB_CLIENT_SECRET, which client "web" of .zitadel/applications/shop.json also names. A variable holds one client\'s secret: give each client its own.',
      },
    ]);
  });

  it("finds nothing when every client names its own variable", () => {
    const store = {
      ...anApplication({ client_id: "store-web", secret: "${{ STORE_SECRET }}" }),
      slug: "store",
    };
    const config = aConfig({ applications: { "shop.json": anApplication(), "store.json": store } });

    expect(SHARED_VARIABLE.check(config, {})).toEqual([]);
  });
});
