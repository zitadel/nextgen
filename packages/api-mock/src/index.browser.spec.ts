/**
 * Browser-mode smoke walk. Confirms `setupMock(worker)` (the
 * `msw/browser` entry point used by the dev playground) intercepts the
 * orval client's requests under real Chromium.
 *
 * The full contract suite lives in `index.spec.ts` and runs in node
 * mode against `msw/node`. This file only covers the browser substrate.
 */
import { configureZitadel } from "@zitadel/api/config";
import { createFlow, submitFlowStep } from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { beforeAll, beforeEach, describe, expect } from "vitest";

import { clearBranding, PASSWORD_FIELD, resetFlow, setupMock } from "./index.js";
import { test } from "./msw-test.js";

const PROJECT_ID = "proj_demo";

beforeAll(() => {
  configureZitadel({ proxyPath: window.location.origin, projectId: PROJECT_ID });
});

beforeEach(() => {
  resetFlow();
  clearBranding();
});

describe("setupMock (browser)", () => {
  test("walks the split sign-in -> done under msw/browser", async ({ worker }) => {
    setupMock(worker);

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.map((f) => f.name)).toEqual(["email"]);

    const password = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(password.step.name).toBe("password");

    const done = await submitFlowStep(start.id, {
      session_token: password.session_token,
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
    expect(done.step.name).toBe("done");
    expect(done.step.complete).toBe("show");
  });
});
