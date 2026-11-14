import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, vi } from "vitest";

import { ReadIssuer } from "@/cli/commands/auth-method/sso/enable/steps/read-issuer";
import { ZitadelError } from "@/lib/errors";

import { it } from "@tests/helpers/fixtures";
import { makeProject, setUpProject } from "@tests/helpers/local-project";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The origin a set-up Project's app serves from.
 */
const ISSUER = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("ZITADEL_ISSUER", "");
});

describe("ReadIssuer", () => {
  it("is the issuer the Project's environment file names", async ({ dir }) => {
    const cwd = await setUpProject(dir);
    await writeFile(join(cwd, ".env.local"), `ZITADEL_ISSUER=${ISSUER}\n`);

    const { issuer } = await new ReadIssuer({ cwd, env: process.env }).run({
      flags: { server: undefined, env: undefined, envFile: undefined },
    });

    expect(issuer).toBe(ISSUER);
  });

  it("refuses a Project that was never set up, with the next move", async ({ dir }) => {
    const cwd = await makeProject(dir);

    const error = await rejectionOf(() => {
      return new ReadIssuer({ cwd, env: process.env }).run({
        flags: { server: undefined, env: undefined, envFile: undefined },
      });
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: "This project has no development issuer",
      hint: "Set the project up first, or set ZITADEL_ISSUER to the origin your app serves from.",
      nextCommands: [{ id: "setup" }],
    });
  });
});
