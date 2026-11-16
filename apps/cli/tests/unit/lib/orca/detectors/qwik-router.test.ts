import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { QwikRouterDetector } from "@/lib/orca/detectors/qwik-router";
import { it } from "@tests/fixtures";

/**
 * Writes a package.json that declares the dependencies.
 *
 * @param cwd - The project directory.
 * @param deps - The dependencies it declares.
 * @param field - Which dependency field declares them.
 * @returns The project directory.
 */
async function project(
  cwd: string,
  deps: Record<string, string>,
  field: "dependencies" | "devDependencies" = "dependencies",
): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ [field]: deps }));
  return cwd;
}

describe("QwikRouterDetector", () => {
  it("recognises a Qwik Router app by @qwik.dev/core + @qwik.dev/router", async ({ dir }) => {
    const facts = await new QwikRouterDetector().detect(
      await project(dir, {
        "@qwik.dev/core": "^2.0.0-rc.3",
        "@qwik.dev/router": "^2.0.0-rc.3",
        vite: "^8",
      }),
    );
    expect(facts?.id).toBe("qwik-router");
    expect(facts?.appDir).toBe("src");
  });

  // create-qwik's empty starter declares Qwik as devDependencies.
  it("recognises Qwik Router declared as devDependencies, as create-qwik emits it", async ({
    dir,
  }) => {
    const facts = await new QwikRouterDetector().detect(
      await project(
        dir,
        { "@qwik.dev/core": "^2.0.0-rc.3", "@qwik.dev/router": "^2.0.0-rc.3", vite: "8.2.1" },
        "devDependencies",
      ),
    );
    expect(facts?.id).toBe("qwik-router");
  });

  it("returns null for a bare Qwik SPA (no @qwik.dev/router)", async ({ dir }) => {
    expect(
      await new QwikRouterDetector().detect(
        await project(dir, { "@qwik.dev/core": "^2", vite: "^8" }),
      ),
    ).toBeNull();
  });

  it("does not match a Qwik 1 City app, whose widgets need an incompatible SDK", async ({
    dir,
  }) => {
    expect(
      await new QwikRouterDetector().detect(
        await project(dir, { "@builder.io/qwik": "^1", "@builder.io/qwik-city": "^1", vite: "^7" }),
      ),
    ).toBeNull();
  });

  it("returns null without a package.json", async ({ dir }) => {
    expect(await new QwikRouterDetector().detect(dir)).toBeNull();
  });
});
