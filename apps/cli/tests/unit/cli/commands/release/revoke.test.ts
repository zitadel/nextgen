import { describe, expect, it } from "vitest";

import ReleaseRevoke from "@/cli/commands/release/revoke";
import { answering } from "@tests/helpers/keyboard";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectDirectory,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { asTerminal as asPerson } from "@tests/helpers/terminal";
import { runCommand } from "@tests/helpers/run-cli";

const { dirs } = usePlatformServer();

const RELEASE = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

describe("release_id", () => {
  it("takes a release id, trimmed", async () => {
    await expect(
      parseArg(ReleaseRevoke.args.release_id, ` ${RELEASE}\n`, "release_id"),
    ).resolves.toBe(RELEASE);
  });

  it.each([
    ["a deployment id", "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    ["a blank", "   "],
    ["a prefix alone", "rel_"],
    ["a space inside", "rel_has space"],
  ])("refuses %s, saying what a release id is and where to list them", async (_, value) => {
    await expect(
      parseArg(ReleaseRevoke.args.release_id, value, "release_id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("must be a release ID"),
      hint: "List the releases to find one.",
    });
  });
});

describe("release revoke asked on a terminal", () => {
  const revokingOn = async (serverUrl: string) => {
    const cwd = await aProjectDirectory("zitadel-release-revoke-", {
      id: "proj_test",
      secret: "ps",
    });
    dirs.push(cwd);
    const talk = answering(false);
    await asPerson(() =>
      runCommand(ReleaseRevoke, "release:revoke", [RELEASE, "--cwd", cwd, "--server", serverUrl]),
    );
    return talk;
  };

  it("asks whether to revoke the release, naming the project and a remote server", async () => {
    const talk = await revokingOn(PLATFORM_URL);

    expect(talk.asked()).toEqual([
      `Revoke ${RELEASE} in project proj_test on preview.zitadel.com so its content can never be served again?`,
    ]);
  });

  it("names a local server by its host and port", async () => {
    const talk = await revokingOn("http://localhost:8112");

    expect(talk.asked()).toEqual([
      `Revoke ${RELEASE} in project proj_test on localhost:8112 so its content can never be served again?`,
    ]);
  });
});
