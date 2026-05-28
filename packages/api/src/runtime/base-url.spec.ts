import { expect, test } from "vitest";

import { getApiBaseUrl } from "./base-url";

test("getApiBaseUrl returns empty string by default", () => {
  expect(getApiBaseUrl()).toBe("");
});
