import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { developmentIssuer } from "../../../../../../../src/commands/auth-method/sso/enable/requirements/issuer";
import { makeProject, setUpProject } from "../../../../../../helpers/local-project";
import { requirementContext } from "../../../../../../helpers/requirement-context";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("developmentIssuer", () => {
  it("is the issuer the environment names", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await setUpProject();
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");

    expect(await developmentIssuer.resolve(requirementContext({ meta: { cwd } }))).toBe(
      "http://localhost:3000",
    );
  });

  it("is nothing for a Project that was never set up", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await makeProject();

    expect(await developmentIssuer.resolve(requirementContext({ meta: { cwd } }))).toBeFalsy();
  });

  it("refuses with the next move", () => {
    expect(developmentIssuer.refusal).toEqual({
      message: "This Project has no development issuer",
      hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
    });
  });
});
