import { describe, expect, it } from "vitest";

import { DUPLICATE_SLUG } from "@/lib/zitadel/rules/applications/duplicate-slug";
import { aConfig, anApplication } from "@tests/helpers/config";

describe("application/duplicate-slug", () => {
  it("refuses a second file that claims a slug, naming the first", () => {
    const copy = anApplication({ client_id: "copy-web", secret: "${{ COPY_SECRET }}" });
    const config = aConfig({ applications: { "shop.json": anApplication(), "store.json": copy } });

    expect(DUPLICATE_SLUG.check(config, {})).toEqual([
      {
        severity: "error",
        rule: "application/duplicate-slug",
        file: ".zitadel/applications/store.json",
        message:
          'application slug "shop" is also used by .zitadel/applications/shop.json. A slug names one application: change the slug here, or delete one of the two files.',
      },
    ]);
  });

  it("finds nothing when every file has its own slug", () => {
    const other = { ...anApplication({ client_id: "b", secret: "${{ B }}" }), slug: "store" };
    const config = aConfig({ applications: { "shop.json": anApplication(), "store.json": other } });

    expect(DUPLICATE_SLUG.check(config, {})).toEqual([]);
  });
});
