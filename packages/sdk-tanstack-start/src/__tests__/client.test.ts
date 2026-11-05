import { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
import { describe, expect, it } from "vitest";

import * as client from "../client";

// The widgets come from `/react`; `/client` only configures the SDK, like the
// other meta-framework SDKs' `/client`, so it never offers a Lit class under a
// React component's name.
describe("@zitadel/sdk-tanstack-start/client", () => {
  it("exports only the SDK configuration helpers", () => {
    expect(Object.keys(client).sort()).toEqual(["configureZitadel", "getApi", "getZitadelConfig"]);
  });

  it.each([
    ["configureZitadel", client.configureZitadel, configureZitadel],
    ["getApi", client.getApi, getApi],
    ["getZitadelConfig", client.getZitadelConfig, getZitadelConfig],
  ])("re-exports @zitadel/api/config's %s", (_name, exported, original) => {
    expect(exported).toBe(original);
  });
});
