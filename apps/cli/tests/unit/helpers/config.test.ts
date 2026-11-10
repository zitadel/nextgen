import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES } from "@/lib/zitadel";
import { aStoreHolding, bodyAt } from "@tests/helpers/config";

/**
 * A connection's file.
 */
const IDP = `${CONFIG_DIRECTORIES.connections}/a.json`;

describe("bodyAt", () => {
  it.for([
    ["a path nothing is at", {}],
    ["a file that is not a json object", { [IDP]: "[1, 2]" }],
  ] as const)("is undefined for %s", ([_what, held]) => {
    const store = aStoreHolding([], held);

    const body = bodyAt(store, IDP);

    expect(body).toBeUndefined();
  });
});
