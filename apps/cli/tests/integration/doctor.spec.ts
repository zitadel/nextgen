import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

usePlatformMock();

describe("doctor", () => {
  it("passes a project straight out of setup", async () => {
    const app = await aSetUpApp();

    expect(await app.doctor()).toSucceed();
  });

  it("reports an unsupported framework version and does not offer to fix it", async () => {
    const app = await aSetUpApp();
    await app.editDocument("package.json", (pkg) => {
      (pkg.dependencies as Record<string, string>).next = "^14.2.0";
    });

    const result = await app.doctor();

    expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(result).toHintAt("Upgrade the app to Next 15+");
    expect(result).not.toSuggest("--fix");
  });

  it("restores a deleted page with the wording the project was set up with", async () => {
    const app = await anApp();
    expect(await app.setup(["--use-case", "business"])).toSucceed();
    await rm(join(app.path, "app/login/page.tsx"));

    expect(await app.doctor(["--fix"])).toSucceed();

    expect(await app.readProjectFile("app/login/page.tsx")).toContain(
      "element.locales = businessLocales",
    );
  });
});
