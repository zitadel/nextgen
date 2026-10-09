import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — plain JS helper, no types
import { gradeConfig, listCells } from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || join(root, "out");
const cfg = JSON.parse(readFileSync(join(root, "journey.config.json"), "utf8"));

// globalSetup has produced a model×repeat matrix under OUT. We assert on the
// first with-skill cell as a representative signal (the report aggregates the
// full matrix into success rates); these are eval signals, not CI gates.
const cells: Array<{ dir: string }> = existsSync(OUT) ? listCells(OUT, ["with-skill"]) : [];
const dir = cells[0]?.dir;
type Row = {
  stage: number;
  status: string;
  why: string;
  parsed: { transcript: Array<{ role: string; kind: string }> };
};
const rows: Row[] = dir ? gradeConfig(dir, cfg.stages) : [];

// We assert the WITH-SKILL run only — that's the thing under test. The baseline
// is captured for comparison in the HTML report, not asserted (it is expected to
// fail without the skill). These are eval signals, not CI gates.
describe("zitadel-cli skill — common-question journey (with skill)", () => {
  for (const s of cfg.stages as Array<{ id: number; title: string }>) {
    it(`stage ${s.id}: ${s.title}`, () => {
      const r = rows.find((x) => x.stage === s.id);
      expect(r, "no result captured for this stage").toBeTruthy();
      expect(r!.status, r!.why).toBe("pass");
    });
  }
});

// A stage with a `user` persona is meant to be interactive: the agent should
// prompt the developer rather than guess, and the simulated user answers. Assert
// that conversation actually happened — a simulated-user answer in the
// transcript proves the agent asked and got a reply (the elicitation path), not
// that it silently picked defaults.
describe("elicitation — the agent prompts, the user answers", () => {
  const interactive = (cfg.stages as Array<{ id: number; user?: string }>).filter((s) => s.user);
  for (const s of interactive) {
    it(`stage ${s.id} is a real conversation`, () => {
      const r = rows.find((x) => x.stage === s.id);
      expect(r, "no result captured for this stage").toBeTruthy();
      const answered = r!.parsed.transcript.some((e) => e.role === "user" && e.kind === "answer");
      expect(answered, "no simulated-user answer captured — the agent didn't prompt the user").toBe(
        true,
      );
    });
  }
});
