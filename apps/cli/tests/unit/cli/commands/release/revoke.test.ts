import { describe, expect, it } from "vitest";

import ReleaseRevoke from "@/cli/commands/release/revoke";
import { answering } from "@tests/helpers/keyboard";
import { parseArg } from "@tests/helpers/inputs";
import {
  aProjectDirectory,
  aReleaseServedOn,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";
import { asTerminal as asPerson } from "@tests/helpers/terminal";
import { parseJson, runCliForTest, runCommand } from "@tests/helpers/run-cli";

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
  /**
   * Arranges a project whose release the given origin kinds serve.
   *
   * @param served - Which origin kinds serve the release.
   * @returns The project's directory, its release and which deployment serves it where.
   */
  async function aServedRelease(served: { primary: boolean; preview: boolean }) {
    const project = await aReleaseServedOn("zitadel-release-revoke-served-", served);
    dirs.push(project.cwd);

    return project;
  }

  /**
   * The command line that revokes a project's release, as a script would.
   *
   * @param project - A project from {@link aServedRelease}.
   * @returns The arguments to run the CLI with.
   */
  function revokeArgumentsOf(project: { cwd: string; releaseId: string }): string[] {
    return [
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
    ];
  }

  it.each([
    ["a primary origin", { primary: true, preview: false }, PRIMARY_ORIGIN, "primary"],
    ["a preview", { primary: false, preview: true }, PREVIEW_URL, "preview"],
    [
      "a primary origin that a preview also serves",
      { primary: true, preview: true },
      PRIMARY_ORIGIN,
      "primary",
    ],
    [
      "a preview that a primary origin also serves",
      { primary: true, preview: true },
      PREVIEW_URL,
      "preview",
    ],
  ] as const)("names %s with its kind and deployment", async (_, served, origin, kind) => {
    const project = await aServedRelease(served);

    const result = await runCliForTest(revokeArgumentsOf(project));

    expect(result).toHintAt(`${origin} (${kind}, ${project.deploymentOn(kind)})`);
  });

  it("names the first three serving origins, counts the rest and lists every one in the details", async () => {
    const project = await aReleaseServedOn(
      "zitadel-release-revoke-served-many-",
      { primary: true, preview: false },
      ["https://b.acme.com", "https://c.acme.com", "https://d.acme.com"],
    );
    dirs.push(project.cwd);

    const result = await runCliForTest(revokeArgumentsOf(project));

    expect(result).toHintAt("; and 1 more");
    expect(parseJson(result.stdout)).toMatchObject({
      details: {
        release_id: project.releaseId,
        origins: Array.from({ length: 4 }, () => expect.anything()),
      },
    });
  });

  it.each([
    [
      "a primary origin",
      { primary: true, preview: false },
      ["deploy --message '<what changed>'", "deployment rollback"],
    ],
    ["a preview", { primary: false, preview: true }, [`preview rm ${PREVIEW_URL}`]],
    [
      "a primary origin and a preview",
      { primary: true, preview: true },
      ["deploy --message '<what changed>'", "deployment rollback", `preview rm ${PREVIEW_URL}`],
    ],
  ] as const)("suggests exactly what frees %s", async (_, served, suggested) => {
    const project = await aServedRelease(served);

    const result = await runCliForTest(revokeArgumentsOf(project));

    expect(result).toSuggestOnly(
      ...suggested.map((command) => {
        return `${command} --server ${PLATFORM_URL} --cwd ${project.cwd}`;
      }),
    );
  });
});
