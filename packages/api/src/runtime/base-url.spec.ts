import { expect, test } from "vitest";

import { setApiBaseUrl, getApiBaseUrl } from "./base-url";

test("set and get works", () => {
  expect(getApiBaseUrl()).toBe("");
  setApiBaseUrl("test.com");
  expect(getApiBaseUrl()).toBe("test.com");
});
