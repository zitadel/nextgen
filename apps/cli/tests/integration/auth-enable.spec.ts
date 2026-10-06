import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

describe("auth enable", () => {
  it("turns a method back on in the published schema once applied", async () => {
    const app = await aSetUpApp();
    expect(await app.disableAuth(["passkey"])).toSucceed();

    expect(await app.enableAuth(["passkey"])).toSucceed();
    expect(await app.apply()).toSucceed();

    const { schema } = await app.publishedSchema();
    expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
  });

  it("enables several methods in one run", async () => {
    const app = await aSetUpApp();
    expect(await app.disableAuth(["passkey"])).toSucceed();

    const result = await app.enableAuth(["password", "passkey"]);

    const { data } = app.envelopeOf<{ changed: string[]; unchanged: string[] }>(result);
    expect(data).toMatchObject({ changed: ["passkey"], unchanged: ["password"] });
  });

  it("says when no login flow offers the method yet", async () => {
    const app = await aSetUpApp();

    const result = await app.enableAuth(["passkey"]);

    const { data } = app.envelopeOf<{ not_offered: string[] }>(result);
    expect(data.not_offered).toEqual(["passkey"]);
  });

  it("changes nothing when the method is already on", async () => {
    const app = await aSetUpApp();
    const files = await app.snapshot();

    expect(await app.enableAuth(["password"])).toSucceed();

    expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
    expect(await app.plan()).toReportNothingToDo();
  });

  it("previews without writing under --dry-run", async () => {
    const app = await aSetUpApp();
    expect(await app.disableAuth(["passkey"])).toSucceed();
    const files = await app.snapshot();

    const result = await app.enableAuth(["passkey"], ["--dry-run"]);

    expect(app.envelopeOf<{ changed: string[] }>(result).data.changed).toEqual(["passkey"]);
    expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
  });
});
