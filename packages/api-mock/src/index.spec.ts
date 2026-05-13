import "./index";
import { createFlow } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { beforeAll, expect } from "vitest";

import { setupMock } from "./index";
import { test } from "./msw-test";

beforeAll(() => {
  setApiBaseUrl("http://localhost:8080");
});

test("test", async ({ worker }) => {
  setupMock(worker);

  const test = await createFlow({
    purpose: "login",
  });

  expect(test).not.toBeNull();
});
