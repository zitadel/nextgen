import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const MANAGED_MARKER = "zitadel-cli: managed-file v1";

const platform = usePlatformMock();

/** A Next 15 app through setup, whose boundary file is `middleware.ts`. */
async function aPatchedApp() {
  const app = await anApp({ nextVersion: "^15.0.0" });
  await app.writeProjectFile("README.md", "# demo-next-app\n\nDeploy notes.\n");
  expect(await app.setup()).toSucceed();
  return app;
}

describe("eject", () => {
  it("removes what setup created and leaves what the developer owns", async () => {
    const app = await aPatchedApp();
    expect(await app.readProjectFile("middleware.ts")).toContain(MANAGED_MARKER);
    await app.writeProjectFile(
      "app/register/page.tsx",
      "export default function Page() { return null; }\n",
    );

    const result = await app.run(["eject", "--force", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ files_removed: string[]; files_preserved: string[] }>(result);
    expect(data.files_removed).toEqual(
      expect.arrayContaining(["app/login/page.tsx", "middleware.ts", "zitadel.json", ".zitadel"]),
    );
    expect(data.files_preserved).toContain("app/register/page.tsx");
    for (const gone of [".zitadel", "zitadel.json", "app/login/page.tsx", "middleware.ts"]) {
      expect(await app.hasProjectFile(gone), `${gone} should be gone`).toBe(false);
    }
    expect(await app.hasProjectFile("app/register/page.tsx")).toBe(true);
  });

  it("takes its guidance back out of the developer's own README", async () => {
    const app = await aPatchedApp();
    expect(await app.readProjectFile("README.md")).toContain("## Authentication (Zitadel)");

    const result = await app.run(["eject", "--force", "--json"]);

    const { data } = app.envelopeOf<{ files_removed: string[] }>(result);
    expect(data.files_removed).toContain("AGENTS.md");
    expect(data.files_removed).toContain("README.md (managed section)");
    expect(await app.hasProjectFile("AGENTS.md")).toBe(false);
    const readme = await app.readProjectFile("README.md");
    expect(readme).toContain("Deploy notes.");
    expect(readme).not.toContain("## Authentication (Zitadel)");
  });
});

describe("branding eject", () => {
  it("publishes the ejected design on the next apply", async () => {
    const published = platform.capturesBrandingPublishes();
    const app = await aSetUpApp();
    expect(published.count).toBe(0);

    expect(
      await app.run(["branding", "eject", "--design", "minimal", "--non-interactive", "--json"]),
    ).toSucceed();
    expect(await app.apply()).toSucceed();

    expect(published.count).toBe(1);
    expect(published.last).toMatchObject({ layout: "centered" });
    expect(typeof published.last?.liquid_template).toBe("string");
    expect(await app.committed.brandingDescriptor()).toMatchObject({
      liquid_template: { $file: "./login.liquid" },
    });
    expect(await app.plan()).toReportNothingToDo();
  });
});
