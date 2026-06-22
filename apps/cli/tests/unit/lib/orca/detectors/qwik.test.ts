import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QwikDetector } from "../../../../../src/lib/orca/detectors/qwik";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "qwik-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("QwikDetector", () => {
  it("recognises a Vite + Qwik app and reports appDir 'src'", async () => {
    const facts = await new QwikDetector().detect(
      await project({ "@builder.io/qwik": "^1", vite: "^5" }),
    );
    expect(facts?.id).toBe("qwik");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes Qwik City (which ships Qwik)", async () => {
    expect(
      await new QwikDetector().detect(
        await project({ "@builder.io/qwik-city": "^1", "@builder.io/qwik": "^1", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new QwikDetector().detect(await project({ "@builder.io/qwik": "^1" }))).toBeNull();
  });

  it("returns null without @builder.io/qwik", async () => {
    expect(await new QwikDetector().detect(await project({ vite: "^5" }))).toBeNull();
  });
});
