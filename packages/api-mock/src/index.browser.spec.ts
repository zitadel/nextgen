/**
 * Browser-mode smoke walk. Confirms `setupMock(worker)` (the
 * `msw/browser` entry point used by the dev playground) intercepts the
 * orval client's requests under real Chromium.
 *
 * The full contract suite lives in `index.spec.ts` and runs in node
 * mode against `msw/node`. This file only covers the browser substrate.
 */
import { ZitadelClient } from "@zitadel/api/runtime/client";
import { createFlow, submitFlowStep } from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { beforeEach, describe, expect } from "vitest";

import { clearBranding, PASSWORD_FIELD, resetFlow, setupMock } from "./index.js";
import { test } from "./msw-test.js";

const PROJECT_ID = "proj_demo";

const client = new ZitadelClient({ baseUrl: window.location.origin });

beforeEach(() => {
  resetFlow();
  clearBranding();
});

describe("setupMock (browser)", () => {
  test("walks the split sign-in -> done under msw/browser", async ({ worker }) => {
    setupMock(worker);

    const start = await createFlow(client, { purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.map((f) => f.name)).toEqual(["email"]);

    const password = await submitFlowStep(client, start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(password.step.name).toBe("password");

    const done = await submitFlowStep(client, start.id, {
      session_token: password.session_token,
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
    expect(done.step.name).toBe("done");
    expect(done.step.complete).toBe("show");
  });
});
