import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const MANAGED_MARKER = "zitadel-cli: managed-file v1";

const server = usePlatformMock();

/** A Next 15 app, whose boundary file is `middleware.ts` rather than `proxy.ts`. */
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
    const published: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/branding", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        published.push(body);
        return HttpResponse.json(
          { id: "brandrev_setup_1", created_at: "2026-08-04T00:00:00.000Z", branding: body },
          { status: 201 },
        );
      }),
      http.get("*/branding/:id", ({ params }) =>
        HttpResponse.json({
          id: params.id,
          created_at: "2026-08-04T00:00:00.000Z",
          branding: published.at(-1) ?? {},
        }),
      ),
    );
    const app = await aSetUpApp();
    expect(published).toHaveLength(0);

    expect(
      await app.run(["branding", "eject", "--design", "minimal", "--non-interactive", "--json"]),
    ).toSucceed();
    expect(await app.apply()).toSucceed();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ layout: "centered" });
    expect(typeof published[0]?.liquid_template).toBe("string");

    const descriptor = JSON.parse(
      await app.readProjectFile(".zitadel/branding/branding.json"),
    ) as Record<string, unknown>;
    expect(descriptor.liquid_template).toEqual({ $file: "./login.liquid" });

    expect(await app.plan()).toReportNothingToDo();
  });
});
