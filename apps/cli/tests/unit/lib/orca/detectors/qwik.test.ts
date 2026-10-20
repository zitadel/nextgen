import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it.each(["2.0.0-beta.1", "2.0.0-beta.44", "1.9.0"])(
    "refuses @qwik.dev/core %s, below the peer range of the SDK",
    async (spec) => {
      await expect(
        new QwikDetector().detect(await project({ "@qwik.dev/core": spec, vite: "^8" })),
      ).rejects.toMatchObject({ code: "E_UNSUPPORTED_PROJECT_SHAPE" });
    },
  );

  it.each(["2.0.0-beta.45", "^2.0.0-beta.45", "^2.0.0-beta.1", "2.0.0-rc.0", "^2.0.0", "3.0.0"])(
    "accepts @qwik.dev/core %s",
    async (spec) => {
      const facts = await new QwikDetector().detect(
        await project({ "@qwik.dev/core": spec, vite: "^8" }),
      );
      expect(facts?.id).toBe("qwik");
    },
  );

  it("refuses an installed beta older than the floor under an accepting range", async () => {
    const cwd = await project({ "@qwik.dev/core": "^2.0.0-beta.1", vite: "^8" });
    await mkdir(join(cwd, "node_modules", "@qwik.dev", "core"), { recursive: true });
    await writeFile(
      join(cwd, "node_modules", "@qwik.dev", "core", "package.json"),
      JSON.stringify({ version: "2.0.0-beta.12" }),
    );

    await expect(new QwikDetector().detect(cwd)).rejects.toThrow("2.0.0-beta.12 is installed");
  });
});
