import { describe, expect, it } from "vitest";

import { SchemaState } from "@/lib/meta-schemas/schema-state";
import { Spelling } from "@/lib/suggestion";

describe("SchemaState.maskVersion", () => {
  it("makes documents normalized for different CLI versions equal", () => {
    const body = { description: "Run `zitadel deploy` to publish.", items: ["`zitadel doctor`"] };

    expect(SchemaState.maskVersion(Spelling.at("1.2.0").normalizeJson(body))).toEqual(
      SchemaState.maskVersion(Spelling.at("1.3.0").normalizeJson(body)),
    );
  });

  it("keeps everything but the version", () => {
    expect(
      SchemaState.maskVersion({ a: "`npx @zitadel/cli@1.2.0 deploy` and @zitadel/sdk" }),
    ).toEqual({ a: "`npx @zitadel/cli@* deploy` and @zitadel/sdk" });
  });
});
