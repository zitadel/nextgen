import { describe, expect, it } from "vitest";

import type { JsonObject } from "@/lib/zitadel";
import { DUPLICATE_CLIENT_ID } from "@/lib/zitadel/rules/applications/duplicate-client-id";
import { aConfig, anApplication } from "@tests/helpers/config";

describe("application/duplicate-client-id", () => {
  it("refuses a client in another file that declares a client_id, naming the first", () => {
    const store = { ...anApplication({ secret: "${{ STORE_SECRET }}" }), slug: "store" };
    const config = aConfig({ applications: { "shop.json": anApplication(), "store.json": store } });

    expect(DUPLICATE_CLIENT_ID.check(config, {})).toEqual([
      {
        severity: "error",
        rule: "application/duplicate-client-id",
        file: ".zitadel/applications/store.json",
        message:
          'client "web" declares the client_id "shop-web", which client "web" of .zitadel/applications/shop.json also declares. A client_id names one client: give each client its own.',
      },
    ]);
  });

  it("refuses a second client of one file that declares a client_id", () => {
    const [web] = anApplication().clients as readonly JsonObject[];
    const admin = { ...web, slug: "admin", secret: "${{ ADMIN }}" };
    const twice = { ...anApplication(), clients: [web ?? {}, admin] };
    const config = aConfig({ applications: { "shop.json": twice } });

    expect(DUPLICATE_CLIENT_ID.check(config, {})).toEqual([
      expect.objectContaining({
        file: ".zitadel/applications/shop.json",
        message:
          'client "admin" declares the client_id "shop-web", which client "web" also declares. A client_id names one client: give each client its own.',
      }),
    ]);
  });
});
