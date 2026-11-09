import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { developmentIssuer } from "@/commands/auth-method/sso/enable/index";
import { ZitadelError } from "@/lib/errors";
import { makeProject, setUpProject } from "@tests/helpers/local-project";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The origin a set-up Project's app serves from.
 */
const ISSUER = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("ZITADEL_ISSUER", "");
});

describe("developmentIssuer", () => {
  it("is the issuer the Project's environment file names", async () => {
    const cwd = await setUpProject();
    await writeFile(join(cwd, ".env.local"), `ZITADEL_ISSUER=${ISSUER}\n`);

    const issuer = await developmentIssuer(cwd, {});

    expect(issuer).toBe(ISSUER);
  });

  it("refuses a Project that was never set up, with the next move", async () => {
    const cwd = await makeProject();

    const error = await rejectionOf(() => {
      return developmentIssuer(cwd, {});
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has no development issuer",
      hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
    });
  });
});
