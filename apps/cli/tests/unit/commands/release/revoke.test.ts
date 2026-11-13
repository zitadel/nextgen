import { describe, expect, it } from "vitest";

import ReleaseRevoke from "@/commands/release/revoke";
import { answering } from "@tests/helpers/keyboard";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectDirectory,
  aReleaseServedOn,
  PLATFORM_URL,
  PREVIEW_URL,
  PRIMARY_ORIGIN,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { asTerminal as asPerson } from "@tests/helpers/terminal";
import { runCliForTest, runCommand } from "@tests/helpers/run-cli";

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

describe("release revoke refused for a release an origin serves", () => {
  const SERVED_ON = [
    ["a primary origin", { primary: true, preview: false }],
    ["a preview", { primary: false, preview: true }],
    ["a primary origin and a preview", { primary: true, preview: true }],
  ] as const;

  /** Revokes the release the project serves, as a script would. */
  async function revokingServedOn(served: { primary: boolean; preview: boolean }) {
    const project = await aReleaseServedOn("zitadel-release-revoke-served-", served);
    dirs.push(project.cwd);
    const result = await runCliForTest([
      "release",
      "revoke",
      project.releaseId,
      "--force",
      "--non-interactive",
      "--json",
      "--cwd",
      project.cwd,
      "--server",
      PLATFORM_URL,
    ]);

    return { result, project };
  }

  it.each(SERVED_ON)("fails as a conflict when %s serves it", async (_, served) => {
    const { result } = await revokingServedOn(served);

    expect(result).toFailWith("E_CONFLICT");
  });

  it("names a primary origin with its kind and the deployment that pins the release", async () => {
    const { result, project } = await revokingServedOn({ primary: true, preview: false });

    expect(result).toHintAt(`${PRIMARY_ORIGIN} (primary, ${project.primary})`);
  });

  it("names a preview with its kind and the deployment that pins the release", async () => {
    const { result, project } = await revokingServedOn({ primary: false, preview: true });

    expect(result).toHintAt(`${PREVIEW_URL} (preview, ${project.preview})`);
  });

  it.each([
    ["a primary origin", PRIMARY_ORIGIN, "primary"],
    ["a preview", PREVIEW_URL, "preview"],
  ] as const)(
    "names %s with its kind and deployment when a primary origin and a preview both serve it",
    async (_, origin, kind) => {
      const { result, project } = await revokingServedOn({ primary: true, preview: true });

      expect(result).toHintAt(`${origin} (${kind}, ${project[kind]})`);
    },
  );

  it.each([
    [
      "a primary origin",
      { primary: true, preview: false },
      ["deploy --message", "deployment rollback"],
    ],
    ["a preview", { primary: false, preview: true }, [`preview rm ${PREVIEW_URL}`]],
    [
      "a primary origin and a preview",
      { primary: true, preview: true },
      ["deploy --message", "deployment rollback", `preview rm ${PREVIEW_URL}`],
    ],
  ] as const)("suggests what frees %s", async (_, served, suggested) => {
    const { result } = await revokingServedOn(served);

    for (const command of suggested) {
      expect(result).toSuggest(command);
    }
  });

  it.each([
    ["a primary origin", { primary: true, preview: false }, `preview rm`],
    ["a preview", { primary: false, preview: true }, "deployment rollback"],
    ["a preview", { primary: false, preview: true }, "deploy --message"],
  ] as const)("does not suggest what cannot free %s: %s", async (_, served, unsuggested) => {
    const { result } = await revokingServedOn(served);

    expect(result).not.toSuggest(unsuggested);
  });

  it("keeps the server's refusal in the details", async () => {
    const { result, project } = await revokingServedOn({ primary: true, preview: false });

    expect(JSON.parse(result.stdout)).toMatchObject({
      details: {
        status: 409,
        body: {
          code: "rel.in_use",
          details: {
            origins: [{ origin: PRIMARY_ORIGIN, deployment_id: project.primary, kind: "primary" }],
          },
        },
      },
    });
  });
});
