import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

type Resolved = { origin: string; deployment_id: string; variables: Array<{ name: string }> };

describe("vars resolve", () => {
  it("reads the values frozen on the default target's deployment", async () => {
    const app = await aSetUpApp();
    expect(await app.setVariable("SUPPORT_EMAIL", "help@acme.com")).toSucceed();
    expect(await app.run(["deploy", "--non-interactive", "--json"])).toSucceed();

    const result = await app.run(["vars", "resolve", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<Resolved>(result);
    expect(data.origin).toBe("");
    expect(data.deployment_id).toMatch(/^dep_/);
    expect(data.variables.map((v) => v.name)).toContain("SUPPORT_EMAIL");
  });

  it("does not see a value set after the deploy", async () => {
    const app = await aSetUpApp();
    expect(await app.setVariable("LATER", "x")).toSucceed();

    const result = await app.run(["vars", "resolve", "--json"]);

    expect(app.envelopeOf<Resolved>(result).data.variables.map((v) => v.name)).not.toContain("LATER");
  });

  it("refuses a target nothing is deployed to", async () => {
    const app = await aSetUpApp();

    expect(
      await app.run(["vars", "resolve", "--origin", "https://nowhere.example", "--json"]),
    ).toFailWith("E_NOT_FOUND");
  });
});
