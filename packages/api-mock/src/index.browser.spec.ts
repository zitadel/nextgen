/**
 * Browser-mode smoke walk. Confirms `setupMock(worker)` (the
 * `msw/browser` entry point used by the dev playground) intercepts the
 * orval client's requests under real Chromium.
 *
 * The full contract suite lives in `index.spec.ts` and runs in node
 * mode against `msw/node`. This file only covers the browser substrate.
 */
import {
  createFlow,
  submitFlowStep,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { beforeAll, beforeEach, describe, expect } from "vitest";

import { clearBranding, resetFlow, setupMock } from "./index.js";
import { test } from "./msw-test.js";

const PROJECT_ID = "demo-project";

beforeAll(() => {
  setApiBaseUrl(window.location.origin);
});

beforeEach(() => {
  resetFlow();
  clearBranding();
});

describe("setupMock (browser)", () => {
  test("walks identifier -> password -> done under msw/browser", async ({ worker }) => {
    setupMock(worker);

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");

    const next = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(next.step.name).toBe("password");

    const done = await submitFlowStep(next.id, {
      session_token: next.session_token,
      action: "submit",
      fields: { password: "hunter2" },
    });
    expect(done.step.name).toBe("done");
    expect(done.step.complete).toBe("redirect");
  });
});
