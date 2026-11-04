import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { developmentIssuer } from "../../../../../../src/commands/auth-method/sso/enable/index";
import { makeProject, setUpProject } from "../../../../../helpers/local-project";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("developmentIssuer", () => {
  it("is the issuer the environment names", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await setUpProject();
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");

    await expect(developmentIssuer(cwd, {})).resolves.toBe("http://localhost:3000");
  });

  it("refuses a Project that was never set up, with the next move", async () => {
    vi.stubEnv("ZITADEL_ISSUER", "");
    const cwd = await makeProject();

    await expect(developmentIssuer(cwd, {})).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has no development issuer",
      hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
    });
  });
});
