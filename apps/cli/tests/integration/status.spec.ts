import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

usePlatformMock();

describe("status", () => {
  it("offers plan but withholds apply while nobody has registered", async () => {
    const app = await aSetUpApp();

    const result = await app.status();

    expect(result).toSucceed();
    expect(result).toSuggest("plan");
    expect(result).not.toSuggest("apply");
    const { data } = app.envelopeOf<{ next_actions: string[] }>(result);
    expect(data.next_actions.join("\n")).toContain("register a user");
  });

  it("calls config pointing at a project that no longer exists orphaned", async () => {
    const app = await anApp();
    await app.writeProjectFile(
      "zitadel.json",
      JSON.stringify({
        $schema: "https://schemas.zitadel.com/v2/project.schema.json",
        project: "orphan",
        server: "https://api.zitadel.cloud",
      }),
    );

    const result = await app.status();

    expect(result).toSucceed();
    expect(app.envelopeOf<{ project: { lifecycle: string } }>(result).data.project.lifecycle).toBe(
      "orphaned-config",
    );
  });

  it("renders a readable summary when not asked for json", async () => {
    const app = await anApp();
    await app.writeProjectFile(
      "zitadel.json",
      JSON.stringify({
        project: "proj-001",
        server: "https://self.example",
        environments: { development: { issuer: "http://localhost:3000" } },
      }),
    );
    await mkdir(join(app.path, ".zitadel"), { recursive: true });
    await app.writeProjectFile(
      ".zitadel/secret",
      JSON.stringify({
        project_id: "proj-001",
        project_secret: "sk",
        preview_secret: "sk",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );

    const result = await app.runWithoutServer(["status", "--server", "https://self.example"]);

    expect(result).toSucceed();
    expect(result).toSay("Zitadel status.");
    expect(result).toSay("project=proj-001");
    expect(result).toSay("(server: self.example)");
    expect(result).toSay("Next:");
    expect(result.stdout.trim().startsWith("{")).toBe(false);
  });
});
