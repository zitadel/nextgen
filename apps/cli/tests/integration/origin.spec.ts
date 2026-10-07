import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

type Entry = { pattern: string; kind: string };

describe("origin", () => {
  it("starts with the origin setup registered as primary", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["origin", "list", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ origins: Entry[] }>(result);
    expect(data.origins).toEqual([{ pattern: "http://localhost:3000", kind: "primary" }]);
  });

  it("adds a preview pattern and reports the check it passed", async () => {
    const app = await aSetUpApp();

    const result = await app.run([
      "origin",
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
    const listed = app.envelopeOf<{ origins: Entry[] }>(await app.run(["origin", "list", "--json"]));
    expect(listed.data.origins).toContainEqual({
      pattern: "https://*-acmeinc.vercel.app",
      kind: "preview",
    });
  });

  it("removes a pattern", async () => {
    const app = await aSetUpApp();
    expect(
      await app.run(["origin", "add", "https://www.acme.com", "--kind", "primary", "--json"]),
    ).toSucceed();

    expect(await app.run(["origin", "rm", "https://www.acme.com", "--json"])).toSucceed();

    const listed = app.envelopeOf<{ origins: Entry[] }>(await app.run(["origin", "list", "--json"]));
    expect(listed.data.origins.map((entry) => entry.pattern)).not.toContain(
      "https://www.acme.com",
    );
  });

  it("changes nothing on a dry run", async () => {
    const app = await aSetUpApp();

    expect(
      await app.run(["origin", "add", "https://www.acme.com", "--kind", "primary", "--dry-run", "--json"]),
    ).toSucceed();

    const listed = app.envelopeOf<{ origins: Entry[] }>(await app.run(["origin", "list", "--json"]));
    expect(listed.data.origins).toHaveLength(1);
  });
});
