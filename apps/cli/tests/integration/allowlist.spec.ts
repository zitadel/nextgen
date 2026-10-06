import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

type Entry = { pattern: string; kind: string };

describe("allowlist", () => {
  it("starts with the origin setup registered as primary", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["allowlist", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ allowed_origins: Entry[] }>(result);
    expect(data.allowed_origins).toEqual([{ pattern: "http://localhost:3000", kind: "primary" }]);
  });

  it("adds a preview pattern and reports the check it passed", async () => {
    const app = await aSetUpApp();

    const result = await app.run([
      "allowlist",
      "add",
      "https://*-acmeinc.vercel.app",
      "--kind",
      "preview",
      "--json",
    ]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ pattern: string; check: { status: string } }>(result);
    expect(data.pattern).toBe("https://*-acmeinc.vercel.app");
    expect(["ok", "warning"]).toContain(data.check.status);
    const listed = app.envelopeOf<{ allowed_origins: Entry[] }>(await app.run(["allowlist", "--json"]));
    expect(listed.data.allowed_origins).toContainEqual({
      pattern: "https://*-acmeinc.vercel.app",
      kind: "preview",
    });
  });

  it("removes a pattern", async () => {
    const app = await aSetUpApp();
    expect(
      await app.run(["allowlist", "add", "https://www.acme.com", "--kind", "primary", "--json"]),
    ).toSucceed();

    expect(await app.run(["allowlist", "rm", "https://www.acme.com", "--json"])).toSucceed();

    const listed = app.envelopeOf<{ allowed_origins: Entry[] }>(await app.run(["allowlist", "--json"]));
    expect(listed.data.allowed_origins.map((entry) => entry.pattern)).not.toContain(
      "https://www.acme.com",
    );
  });

  it("changes nothing on a dry run", async () => {
    const app = await aSetUpApp();

    expect(
      await app.run(["allowlist", "add", "https://www.acme.com", "--kind", "primary", "--dry-run", "--json"]),
    ).toSucceed();

    const listed = app.envelopeOf<{ allowed_origins: Entry[] }>(await app.run(["allowlist", "--json"]));
    expect(listed.data.allowed_origins).toHaveLength(1);
  });
});
