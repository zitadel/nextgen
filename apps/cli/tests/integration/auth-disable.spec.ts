import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

describe("auth disable", () => {
  it("turns a method off in the published schema once applied", async () => {
    const app = await aSetUpApp();

    expect(await app.disableAuth(["passkey"])).toSucceed();
    expect(await app.apply()).toSucceed();

    const { schema } = await app.publishedSchema();
    expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: false });
    expect(schema["x-auth-methods"]?.password).toEqual({ enabled: true });
  });

  it("leaves the change for apply to publish", async () => {
    const app = await aSetUpApp();

    expect(await app.disableAuth(["passkey"])).toSucceed();

    expect(await app.plan()).not.toReportNothingToDo();
  });

  it("refuses a method a login flow still asks for and changes nothing", async () => {
    const app = await aSetUpApp();
    const files = await app.snapshot();

    const result = await app.disableAuth(["password"]);

    expect(result).toFailWith("E_VALIDATION");
    expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
    expect(await app.plan()).toReportNothingToDo();
  });

  it("refuses passkey on a project whose login starts with a passkey", async () => {
    const app = await aSetUpApp(["--preset", "passkey-first"]);

    expect(await app.disableAuth(["passkey"])).toFailWith("E_VALIDATION");
  });

  it("changes nothing when the method is already off", async () => {
    const app = await aSetUpApp();
    expect(await app.disableAuth(["passkey"])).toSucceed();
    const files = await app.snapshot();

    expect(await app.disableAuth(["passkey"])).toSucceed();

    expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
  });

  it("asks for a mode rather than guessing one", async () => {
    const app = await aSetUpApp();

    expect(await app.disableAuth([])).toFailWith("E_VALIDATION");
  });
});
