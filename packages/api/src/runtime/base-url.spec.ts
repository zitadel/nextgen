import { expect, test } from "vitest";

import { getProxyPath } from "./base-url";

test("getProxyPath returns empty string by default", () => {
  expect(getProxyPath()).toBe("");
});
