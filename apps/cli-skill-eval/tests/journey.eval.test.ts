import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — plain JS helper, no types
import { gradeConfig } from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || join(root, "out");
const cfg = JSON.parse(readFileSync(join(root, "journey.config.json"), "utf8"));

// globalSetup has already produced results in OUT by the time this runs.
const dir = join(OUT, "with-skill");
const rows: Array<{ stage: number; status: string; why: string }> = existsSync(dir)
  ? gradeConfig(dir, cfg.stages)
  : [];

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
