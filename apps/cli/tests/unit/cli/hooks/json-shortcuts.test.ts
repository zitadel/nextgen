import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

describe("the json-shortcuts hook", () => {
  it("answers --version --json as the version envelope", async () => {
    const result = await runCliForTest(["--version", "--json"]);

    expect(result).toSucceed();
    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      command: "version",
    });
  });

  it("answers --help --json as the help envelope", async () => {
    const result = await runCliForTest(["--help", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      command: "help",
    });
  });

  it.each([["origin", "--help"], ["-h"], ["origin", "-h"]])(
    "answers %s with --json as the help envelope",
    async (...words) => {
      const result = await runCliForTest([...words, "--json"]);

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "help",
      });
    },
  );

  it("leaves help as text when json comes after a --", async () => {
    const result = await runCliForTest(["--help", "--", "--json"]);

    expect(result.stdout).toContain("Usage");
  });

  it("leaves help as text when nothing asks for JSON", async () => {
    const result = await runCliForTest(["--help"]);

    expect(result.stdout).toContain("Usage");
  });

  it("leaves --version as the plain version line when nothing asks for JSON", async () => {
    const result = await runCliForTest(["--version"]);

    expect(result.stdout).toMatch(/zitadel|@zitadel\/cli/);
    expect(result.stdout).not.toContain('"status"');
  });

  it.each([["version"], ["commands"]])(
    "leaves %s with --json to its own command, as one envelope",
    async (id) => {
      const result = await runCliForTest([id, "--json"]);

      expect(parseJson(result.stdout)).toMatchObject({ status: "ok", command: id });
    },
  );
});
