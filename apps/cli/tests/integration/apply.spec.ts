import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

/** A flow whose captcha gate reads its secret from the environment. */
const FLOW_NEEDING_A_CAPTCHA_SECRET = {
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

describe("apply", () => {
  it("reports a project that already matches as synced", async () => {
    const app = await aSetUpApp();

    const result = await app.apply();

    expect(result).toSucceed();
    expect(app.envelopeOf<{ synced: boolean }>(result).data.synced).toBe(true);
  });

  it("publishes a new schema revision and moves the flow onto it in one run", async () => {
    const app = await aSetUpApp();
    const before = await app.publishedSchema();
    await app.editUserSchema((schema) => {
      schema.properties.company = { type: "string" };
    });
    await app.editLoginFlow((flow) => {
      flow.steps.find((step) => step.name === "register")?.fields?.push("company");
    });

    expect(await app.apply()).toSucceed();

    const after = await app.publishedSchema();
    expect(after.id).not.toBe(before.id);
    expect(after.schema.properties).toHaveProperty("company");

    const flow = await app.publishedFlow();
    expect(flow.flow_definition.user_schema).toBe(after.id);
    expect(flow.flow_definition.steps.find((step) => step.name === "register")?.fields).toContain(
      "company",
    );
    expect(await app.plan()).toReportNothingToDo();
  });

  it("refuses a flow whose gate needs an environment variable that is not set", async () => {
    const app = await aSetUpApp();
    await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

    const refused = await app.apply();

    expect(refused).toFailWith("E_VALIDATION");
    expect(refused).toExplain("Missing environment variables");
  });

  it("accepts that flow once the variable is set", async () => {
    const app = await aSetUpApp();
    await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

    const result = await app.run(["apply", "--non-interactive", "--json"], {
      MY_CAPTCHA_SECRET: "hunter2",
    });

    expect(result).toSucceed();
  });
});
