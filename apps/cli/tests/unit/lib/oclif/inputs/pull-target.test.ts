import { describe, expect, it } from "vitest";

import { pullTargetArg } from "../../../../../src/lib/oclif/inputs/pull-target";

async function parse(input: string): Promise<string> {
  const arg = pullTargetArg();
  return (await arg.parse(input, {} as never, arg)) as string;
}

describe("pullTargetArg", () => {
  it.each(["latest", "rel_01ABC", "dep_01ABC"])("accepts %s", async (target) => {
    await expect(parse(target)).resolves.toBe(target);
  });

  it("refuses a target pull cannot read, naming it", async () => {
    await expect(parse("sch_01ABC")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Don\'t know how to pull "sch_01ABC".',
      hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
    });
  });
});
