import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp } from "../helpers/project";

const platform = usePlatformMock();

describe("skills add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        const result = await app.run(["skills", "add", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await anApp();
        platform.isUnavailable();

        const result = await app.run(["skills", "add", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("adds the skills the CLI ships, with the files they reference", async () => {
        const app = await anApp();
        const before = await app.snapshot();

        expect(await app.run(["skills", "add", "--json"])).toSucceed();

        const { added } = await before.changes();
        expect(added).toEqual(
          expect.arrayContaining([
            ".agents/skills/zitadel/SKILL.md",
            ".agents/skills/zitadel-cli/SKILL.md",
            ".agents/skills/zitadel-cli/references/driving-login-ui.md",
            ".agents/skills/zitadel-components/SKILL.md",
            ".agents/skills/zitadel-sdk-next/SKILL.md",
          ]),
        );
      });

      it("changes nothing when the skills are already this version's", async () => {
        const app = await anApp();
        await app.run(["skills", "add", "--json"]);
        const before = await app.snapshot();

        expect(await app.run(["skills", "add", "--json"])).toSucceed();

        const { added, modified, removed } = await before.changes();
        expect([...added, ...modified, ...removed]).toEqual([]);
      });

      it("adds nothing on a dry run", async () => {
        const app = await anApp();
        const before = await app.snapshot();

        expect(await app.run(["skills", "add", "--dry-run", "--json"])).toSucceed();

        const { added } = await before.changes();
        expect(added).toEqual([]);
      });
    });

    describe("rendered for a terminal", () => {
      it("names the folder agents read the skills from", async () => {
        const app = await anApp();

        const result = await app.run(["skills", "add"]);

        expect(result).toPrint(".agents/skills");
      });
    });
  });
});
