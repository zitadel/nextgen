import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, NOTHING_TO_RECONCILE } from "../helpers/project";

usePlatformMock();

describe("apply", () => {
  it("reports a clean project as already synced", async () => {
    const app = await aSetUpApp();

    const result = await app.apply();

    expect(result.exitCode).toBe(0);
    expect(app.envelopeOf<{ synced: boolean }>(result).data.synced).toBe(true);
  });

  it("publishes a schema revision and re-pins the flow to it in one run", async () => {
    const app = await aSetUpApp();
    const originalSchemaId = (await app.syncState()).resources[
      ".zitadel/schemas/default-human-user.json"
    ]?.id;

    await app.editDocument(".zitadel/schemas/default-human-user.json", (schema) => {
      (schema.properties as Record<string, unknown>).company = { type: "string" };
    });
    await app.editDocument(".zitadel/flows/default-login.json", (flow) => {
      const steps = flow.steps as Array<{ name: string; fields?: string[] }>;
      steps.find((step) => step.name === "register")?.fields?.push("company");
    });

    const result = await app.apply();
    expect(result.exitCode).toBe(0);
    const { data } = app.envelopeOf<{ files_updated: string[] }>(result);
    expect(data.files_updated).toContain(".zitadel/flows/default-login.json");

    const newSchemaId = (await app.syncState()).resources[
      ".zitadel/schemas/default-human-user.json"
    ]?.id;
    expect(newSchemaId).toMatch(/^sch_/);
    expect(newSchemaId).not.toBe(originalSchemaId);

    // A revision is immutable, so the flow has to move to the new id in the
    // same run or it would validate against a schema without `company`.
    const flow = await app.loginFlow();
    expect(flow.user_schema).toBe(newSchemaId);
    expect(flow.steps.find((step) => step.name === "register")?.fields).toContain("company");

    expect(await app.plan()).toMatchObject(NOTHING_TO_RECONCILE);
  });

  it("refuses a flow whose gate needs an environment variable that is not set", async () => {
    const app = await aSetUpApp();
    await writeFile(
      join(app.path, ".zitadel/flows/default.json"),
      JSON.stringify(flowNeedingCaptchaSecret(), null, 2),
    );

    const refused = await app.apply();
    expect(refused.exitCode).toBe(3);
    const envelope = app.envelopeOf(refused);
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.message).toContain("Missing environment variables");

    const accepted = await app.run(
      ["apply", "--non-interactive", "--json"],
      { MY_CAPTCHA_SECRET: "hunter2" },
    );
    expect(accepted.exitCode).toBe(0);
  });
});

function flowNeedingCaptchaSecret() {
  return {
    name: "default",
    status: "active",
    user_schema:
      "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        fields: [],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "done" } },
        gates: {
          captcha: {
            kind: "captcha",
            provider: "altcha",
            config: { client_secret_env: "MY_CAPTCHA_SECRET" },
          },
        },
      },
      { name: "done", complete: "show" },
    ],
  };
}
