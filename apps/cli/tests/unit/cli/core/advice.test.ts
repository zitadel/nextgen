import { describe, expect, it } from "vitest";

import { advised } from "@/cli/core/advice";
import {
  OrcaFrameworkError,
  OrcaPatchFileConflictError,
  OrcaPatchFileMissingError,
  OrcaRendererError,
  OrcaScaffoldBlockedError,
} from "@/lib/orca";
import { BackendUnavailableError } from "@/lib/backend";
import type { ZitadelError } from "@/lib/errors";
import { ZitadelConfigEditBreaksFlowsError } from "@/lib/zitadel";

describe("advised", () => {
  it.each([
    ["a method still in use", { kind: "method-in-use", uses: [], dryRun: true }, true],
    ["flows already broken on disk", { kind: "broken", dryRun: true }, true],
    ["an edit that would break a flow, which is never saved", { kind: "broken" }, false],
  ] as const)("gives %s its follow-up", (_name, report, follows) => {
    const result = advised(
      new ZitadelConfigEditBreaksFlowsError({
        ...report,
        file: "default-human-user.json",
        heading: "A login flow would break:",
        hint: "Fix it.",
        issues: [],
      }),
    );

    expect(result).toMatchObject({
      nextCommands: follows ? [{ id: "deploy", flags: { dryRun: true } }] : undefined,
    });
  });

  it("names the --server flag in the hint of a server that cannot be reached", () => {
    const error = new BackendUnavailableError("no response", { reason: "unreachable" });

    expect(advised(error)).toMatchObject({
      hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
    });
  });

  it("words what to do next with the CLI's own flags", () => {
    const hintOf = (error: unknown): string | undefined => {
      return (advised(error) as ZitadelError).hint;
    };

    expect(hintOf(new OrcaFrameworkError("none", "why"))).toContain("--cwd");
    expect(
      hintOf(
        new OrcaFrameworkError("mismatch", "why", {
          details: { requested: "react", detected: "next", requestedName: "React" },
        }),
      ),
    ).toContain("--framework next");
    expect(hintOf(new OrcaScaffoldBlockedError("occupied", "why"))).toContain("--force");
    expect(hintOf(new OrcaRendererError("pending", "why"))).toContain("--renderer");
  });

  it("says whether replacing files would resolve a conflict", () => {
    const hintOf = (error: unknown): string | undefined => {
      return (advised(error) as ZitadelError).hint;
    };

    expect(hintOf(new OrcaPatchFileConflictError("why", { force: "replaces" }))).toContain(
      "Rerun with --force",
    );
    expect(hintOf(new OrcaPatchFileConflictError("why", { force: "useless" }))).toContain(
      "can't fix this",
    );
  });

  it("leaves a failure with no advice as it was", () => {
    const error = new OrcaPatchFileMissingError("why");

    expect(advised(error)).toBe(error);
    expect(advised(new Error("plain"))).toBeInstanceOf(Error);
  });
});
