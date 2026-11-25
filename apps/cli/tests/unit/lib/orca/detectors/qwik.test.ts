import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { QwikDetector } from "@/lib/orca/detectors/qwik";
import { it } from "@tests/fixtures";

/**
 * Writes a `package.json` with the given dependencies into a directory.
 *
 * @param cwd - The directory to write it in.
 * @param deps - The dependencies it declares.
 * @returns The directory, for the detector to look at.
 */
async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("QwikDetector", () => {
  it("recognises a Vite + Qwik 2 app and reports appDir 'src'", async ({ dir }) => {
    const facts = await new QwikDetector().detect(
      await project(dir, { "@qwik.dev/core": "^2.0.0-beta.45", vite: "^8" }),
    );
    expect(facts?.id).toBe("qwik");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes the Qwik router meta-framework (which ships Qwik)", async ({ dir }) => {
    expect(
      await new QwikDetector().detect(
        await project(dir, { "@qwik.dev/router": "^2", "@qwik.dev/core": "^2", vite: "^8" }),
      ),
    ).toBeNull();
  });

  it("does not match a Qwik 1 app (@builder.io/qwik), which needs an incompatible SDK", async ({
    dir,
  }) => {
    expect(
      await new QwikDetector().detect(await project(dir, { "@builder.io/qwik": "^1", vite: "^8" })),
    ).toBeNull();
  });

  it("returns null without vite", async ({ dir }) => {
    expect(
      await new QwikDetector().detect(await project(dir, { "@qwik.dev/core": "^2" })),
    ).toBeNull();
  });

  it("returns null without @qwik.dev/core", async ({ dir }) => {
    expect(await new QwikDetector().detect(await project(dir, { vite: "^8" }))).toBeNull();
  });

  it.for(["2.0.0-beta.1", "2.0.0-beta.44", "1.9.0"])(
    "refuses @qwik.dev/core %s, below the peer range of the SDK",
    async (spec, { dir }) => {
      await expect(
        new QwikDetector().detect(await project(dir, { "@qwik.dev/core": spec, vite: "^8" })),
      ).rejects.toMatchObject({
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
      });
    },
  );

  it.for(["2.0.0-beta.45", "^2.0.0-beta.45", "^2.0.0-beta.1", "2.0.0-rc.0", "^2.0.0", "3.0.0"])(
    "accepts @qwik.dev/core %s",
    async (spec, { dir }) => {
      const facts = await new QwikDetector().detect(
        await project(dir, { "@qwik.dev/core": spec, vite: "^8" }),
      );
      expect(facts?.id).toBe("qwik");
    },
  );

  it("refuses an installed beta older than the floor under an accepting range", async ({ dir }) => {
    const cwd = await project(dir, { "@qwik.dev/core": "^2.0.0-beta.1", vite: "^8" });
    await mkdir(join(cwd, "node_modules", "@qwik.dev", "core"), { recursive: true });
    await writeFile(
      join(cwd, "node_modules", "@qwik.dev", "core", "package.json"),
      JSON.stringify({ version: "2.0.0-beta.12" }),
    );

    await expect(new QwikDetector().detect(cwd)).rejects.toThrow("2.0.0-beta.12 is installed");
  });
});
