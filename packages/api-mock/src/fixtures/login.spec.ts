/**
 * Conformance guardrail for the runtime login-flow fixtures.
 *
 * The orchestrator renders these `CreateFlow201` responses by reading action
 * `name`/`text_key` from the Liquid template — it never touches `kind`, so a
 * fixture that drifts from the OpenAPI spec (e.g. a missing required `kind`)
 * stays invisible at render time. The wire shape is also never validated by
 * the standalone `spec-conformance.spec.ts` server test, which exercises the
 * flow-*definition* endpoints, not the runtime `POST /flow` responses.
 *
 * This test closes that gap: every step builder is parsed against the
 * orval-generated `GetFlowStepResponse` zod (the runtime flow envelope — wire
 * identical to `createFlow`/`submitFlowStep` per the fixture module docs). If
 * the spec changes and the fixtures fall behind, this fails in CI instead of
 * silently shipping a non-conformant mock.
 */
import { GetFlowStepResponse } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, test } from "vitest";

import type { StepFixtureInput } from "./login.js";
import {
  doneStep,
  identifierStep,
  passkeyLoginStep,
  passkeySetupStep,
  passkeyUpsellStep,
  passwordStep,
  recoverStep,
  registerPasswordStep,
  registerStep,
  ssoRedirectStep,
} from "./login.js";

const input: StepFixtureInput = {
  flowId: "flow_mock",
  sessionToken: "sess_token_mock",
  iss: "http://localhost:8080",
  capturedEmail: "mock-user@example.com",
};

const syncBuilders = {
  identifierStep,
  registerStep,
  registerPasswordStep,
  passwordStep,
  recoverStep,
  passkeyUpsellStep,
  passkeySetupStep,
  passkeyLoginStep,
  ssoRedirectStep,
} satisfies Record<string, (i: StepFixtureInput) => unknown>;

describe("runtime login-flow fixtures match the generated flow-step schema", () => {
  test.each(Object.entries(syncBuilders))("%s is spec-conformant", (_name, build) => {
    expect(() => GetFlowStepResponse.parse(build(input))).not.toThrow();
  });

  // `doneStep` is async (it signs a handoff JWT), so it can't ride the sync
  // `.each` above.
  test("doneStep is spec-conformant", async () => {
    const resolved = await doneStep(input);
    expect(() => GetFlowStepResponse.parse(resolved)).not.toThrow();
  });
});
