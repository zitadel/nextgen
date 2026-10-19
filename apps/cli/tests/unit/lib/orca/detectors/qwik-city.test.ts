import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QwikCityDetector } from "../../../../../src/lib/orca/detectors/qwik-city";

const dirs: string[] = [];

async function project(
  deps: Record<string, string>,
  field: "dependencies" | "devDependencies" = "dependencies",
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "qwik-city-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ [field]: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("QwikCityDetector", () => {
  it("recognises a Qwik City app by @qwik.dev/core + @qwik.dev/router", async () => {
    const facts = await new QwikCityDetector().detect(
      await project({
        "@qwik.dev/core": "^2.0.0-rc.3",
        "@qwik.dev/router": "^2.0.0-rc.3",
        vite: "^8",
      }),
    );
    expect(facts?.id).toBe("qwik-city");
    expect(facts?.appDir).toBe("src");
  });

  // create-qwik's empty starter declares Qwik as devDependencies.
  it("recognises Qwik City declared as devDependencies, as create-qwik emits it", async () => {
    const facts = await new QwikCityDetector().detect(
      await project(
        { "@qwik.dev/core": "^2.0.0-rc.3", "@qwik.dev/router": "^2.0.0-rc.3", vite: "8.2.1" },
        "devDependencies",
      ),
    );
    expect(facts?.id).toBe("qwik-city");
  });

  it("returns null for a bare Qwik SPA (no @qwik.dev/router)", async () => {
    expect(
      await new QwikCityDetector().detect(await project({ "@qwik.dev/core": "^2", vite: "^8" })),
    ).toBeNull();
  });

  it("does not match a Qwik 1 City app, whose widgets need an incompatible SDK", async () => {
    expect(
      await new QwikCityDetector().detect(
        await project({ "@builder.io/qwik": "^1", "@builder.io/qwik-city": "^1", vite: "^7" }),
      ),
    ).toBeNull();
  });

  it("returns null without a package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "qwik-city-empty-"));
    dirs.push(cwd);
    expect(await new QwikCityDetector().detect(cwd)).toBeNull();
  });
});
