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
  it("recognises a Vite + Qwik 2 app and reports appDir 'src'", async () => {
    const facts = await new QwikDetector().detect(
      await project({ "@qwik.dev/core": "^2.0.0-beta.45", vite: "^8" }),
    );
    expect(facts?.id).toBe("qwik");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes the Qwik router meta-framework (which ships Qwik)", async () => {
    expect(
      await new QwikDetector().detect(
        await project({ "@qwik.dev/router": "^2", "@qwik.dev/core": "^2", vite: "^8" }),
      ),
    ).toBeNull();
  });

  it("does not match a Qwik 1 app (@builder.io/qwik), which needs an incompatible SDK", async () => {
    expect(
      await new QwikDetector().detect(await project({ "@builder.io/qwik": "^1", vite: "^8" })),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new QwikDetector().detect(await project({ "@qwik.dev/core": "^2" }))).toBeNull();
  });

  it("returns null without @qwik.dev/core", async () => {
    expect(await new QwikDetector().detect(await project({ vite: "^8" }))).toBeNull();
  });
});
