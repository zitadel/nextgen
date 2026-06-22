import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QwikCityDetector } from "../../../../../src/lib/orca/detectors/qwik-city";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "qwik-city-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("QwikCityDetector", () => {
  it("recognises a Qwik City app by @builder.io/qwik + @builder.io/qwik-city", async () => {
    const facts = await new QwikCityDetector().detect(
      await project({
        "@builder.io/qwik": "^1",
        "@builder.io/qwik-city": "^1",
        vite: "^7",
      }),
    );
    expect(facts?.id).toBe("qwik-city");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Qwik SPA (no @builder.io/qwik-city)", async () => {
    expect(
      await new QwikCityDetector().detect(
        await project({ "@builder.io/qwik": "^1", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without a package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "qwik-city-empty-"));
    dirs.push(cwd);
    expect(await new QwikCityDetector().detect(cwd)).toBeNull();
  });
});
