import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

usePlatformMock();

describe("doctor", () => {
  it("passes a project straight out of setup", async () => {
    const app = await aSetUpApp();

    const result = await app.doctor();

    expect(result.exitCode, result.stdout).toBe(0);
    expect(app.envelopeOf(result).status).toBe("ok");
  });

  it("reports an unsupported framework version and does not offer to fix it", async () => {
    const app = await aSetUpApp();
    await app.editDocument("package.json", (pkg) => {
      (pkg.dependencies as Record<string, string>).next = "^14.2.0";
    });

    const result = await app.doctor();

    expect(result.exitCode, result.stdout).toBe(3);
    const envelope = app.envelopeOf(result);
    expect(envelope.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(envelope.hint).toContain("Upgrade the app to Next 15+");
    // --fix cannot raise a framework version, so suggesting it would be a lie.
    expect((envelope.next_commands ?? []).join(" ")).not.toContain("--fix");
  });

  it("restores a deleted page with the wording the project was set up with", async () => {
    const app = await anApp();
    expect((await app.setup(["--use-case", "business"])).exitCode).toBe(0);
    await rm(join(app.path, "app/login/page.tsx"));

    const result = await app.doctor(["--fix"]);

    expect(result.exitCode, result.stdout).toBe(0);
    // The repair reads the recorded use case rather than assuming setup's
    // defaults, so the regenerated page keeps the business copy.
    expect(await app.readProjectFile("app/login/page.tsx")).toContain(
      "element.locales = businessLocales",
    );
  });
});
