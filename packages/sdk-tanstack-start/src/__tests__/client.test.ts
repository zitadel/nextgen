import { describeClientEntry } from "@zitadel/server-sdk-contract/client";
import { describe, expect, it } from "vitest";

import * as entry from "../client";

describeClientEntry(entry);

// The widgets come from `/components`; `/client` only configures the SDK, like the
// other meta-framework SDKs' `/client`, so it never offers a Lit class under a
// React component's name.
describe("@zitadel/sdk-tanstack-start/client", () => {
  it("exports only the SDK configuration helpers", () => {
    expect(Object.keys(entry).sort()).toEqual(["configureZitadel", "getApi", "getZitadelConfig"]);
  });
});
