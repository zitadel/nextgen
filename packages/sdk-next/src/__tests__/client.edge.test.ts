import * as client from "@zitadel/sdk-next/client";
import { describe, expect, it } from "vitest";

import { describeEdgeEntry } from "@zitadel/framework-contract/client-edge";

const { businessLocales } = client;

describeEdgeEntry(businessLocales);

describe("the client entry in the edge runtime", () => {
  it("keeps the configuration it re-exports", () => {
    expect(client.configureZitadel).toBeTypeOf("function");
    expect(client.getApi).toBeTypeOf("function");
  });

  it("exports no element class", () => {
    expect(Object.keys(client).filter((name) => /^Zitadel[A-Z]/.test(name))).toEqual([]);
  });
});
