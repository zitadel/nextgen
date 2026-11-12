import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

/**
 * Every skill the CLI ships.
 */
const SKILLS = [
  "zitadel",
  "zitadel-cli",
  "zitadel-components",
  "zitadel-sdk-angular",
  "zitadel-sdk-next",
  "zitadel-sdk-nuxt",
  "zitadel-sdk-qwik",
  "zitadel-sdk-qwik-router",
  "zitadel-sdk-react",
  "zitadel-sdk-solid",
  "zitadel-sdk-solid-start",
  "zitadel-sdk-svelte",
  "zitadel-sdk-sveltekit",
  "zitadel-sdk-tanstack-start",
  "zitadel-sdk-vue",
];

/**
 * The folders the skills go to.
 */
const DIRECTORIES = [".agents/skills", ".claude/skills"];

/**
 * The headline of a run that added the skills.
 */
const ADDED = `Added the ${SKILLS.length} Zitadel agent skills of CLI ${cliVersion.version}`;

/**
 * The headline of a dry run.
 */
const WOULD_ADD = `Would add the ${SKILLS.length} Zitadel agent skills of CLI ${cliVersion.version} (dry run)`;

describe("skills add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await anApp({ usesClaudeCode: true });
        platform.isNotZitadel();

        const result = await app.run(["skills", "add", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await anApp({ usesClaudeCode: true });
        platform.isUnavailable();

        const result = await app.run(["skills", "add", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await anApp({ usesClaudeCode: true });
        platform.refusesConnections();

        const result = await app.run(["skills", "add", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await anApp({ usesClaudeCode: true });
      platform.servesAHostileOrigin();
      const args = ["skills", "add"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reports the skills it added", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "skills:add",
          source: "",
          status: "ok",
          data: { title: ADDED, skills: SKILLS, directories: DIRECTORIES },
          warnings: [],
        });
      });

      it("reports the same again when the skills are already this version's", async () => {
        const app = await anApp({ usesClaudeCode: true });
        await app.run(["skills", "add", "--json"]);

        const result = await app.run(["skills", "add", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "skills:add",
          source: "",
          status: "ok",
          data: { title: ADDED, skills: SKILLS, directories: DIRECTORIES },
          warnings: [],
        });
      });

      it("reports a dry run, with the real command to run next", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "skills:add",
          source: "",
          status: "ok",
          data: {
            title: WOULD_ADD,
            dry_run: true,
            skills: SKILLS,
            directories: DIRECTORIES,
            next_commands: [
              expectedPublicCliCommand(`skills add --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("adds the skills the CLI ships, with the files they reference", async () => {
        const app = await anApp({ usesClaudeCode: true });
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
        const app = await anApp({ usesClaudeCode: true });
        await app.run(["skills", "add", "--json"]);
        const before = await app.snapshot();

        expect(await app.run(["skills", "add", "--json"])).toSucceed();

        const { added, modified, removed } = await before.changes();
        expect([...added, ...modified, ...removed]).toEqual([]);
      });

      it("adds nothing on a dry run", async () => {
        const app = await anApp({ usesClaudeCode: true });
        const before = await app.snapshot();

        expect(await app.run(["skills", "add", "--dry-run", "--json"])).toSucceed();

        const { added } = await before.changes();
        expect(added).toEqual([]);
      });
    });

    describe("rendered for a terminal", () => {
      it("heads the text with the headline the envelope carries", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add"]);

        expect(result.stdout.split("\n")[0]).toBe(ADDED);
      });

      it("heads a dry run with the headline the envelope carries", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add", "--dry-run"]);

        expect(result.stdout.split("\n")[0]).toBe(WOULD_ADD);
      });

      it("names the folder agents read the skills from", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add"]);

        expect(result).toPrint(".agents/skills");
      });

      it("names the folder Claude Code reads the skills from", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add"]);

        expect(result).toPrint(".claude/skills");
      });

      it("names the real command after a dry run", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add", "--dry-run"]);

        expect(result).toSay(
          expectedPublicCliCommand(`skills add --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
        );
      });

      it("says each skill folder once", async () => {
        const app = await anApp({ usesClaudeCode: true });

        const result = await app.run(["skills", "add"]);

        expect(result).toSayOnce("  .claude/skills");
      });
    });
  });
});
