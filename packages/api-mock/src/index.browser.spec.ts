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
} from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { configureZitadel } from "@zitadel/api/config";
import { beforeAll, beforeEach, describe, expect } from "vitest";

import { clearBranding, resetFlow, setupMock } from "./index.js";
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
  test("walks combined sign-in -> passkey-upsell -> done under msw/browser", async ({ worker }) => {
    setupMock(worker);

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.some((f) => f.name === "password")).toBe(true);

    const next = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
    });
    expect(next.step.name).toBe("passkey-upsell");

    const done = await submitFlowStep(next.id, {
      session_token: next.session_token,
      action: "skip",
      fields: {},
    });
    expect(done.step.name).toBe("done");
    expect(done.step.complete).toBe("show");
  });
});
