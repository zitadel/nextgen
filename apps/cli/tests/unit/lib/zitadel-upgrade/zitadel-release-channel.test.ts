import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ZitadelReleaseChannel } from "@/lib/zitadel-upgrade";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe("ZitadelReleaseChannel.latestFresh", () => {
  it("reads the version on the dist-tag of the CLI's own channel", async () => {
    server.use(
      http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0", alpha: "3.0.0-alpha.1" })),
    );

    const stable = await new ZitadelReleaseChannel("1.0.0", {}).latestFresh();
    const alpha = await new ZitadelReleaseChannel("3.0.0-alpha.0", {}).latestFresh();

    expect([stable?.version, alpha?.version]).toEqual(["2.0.0", "3.0.0-alpha.1"]);
  });
});

describe("ZitadelReleaseChannel.isDisabled", () => {
  it.each([
    [{ ZITADEL_UPDATE_CHECK: "0" }, true],
    [{ CI: "true" }, true],
    [{ CI: "false" }, false],
    [{}, false],
  ])("for %o is %s", (environment, disabled) => {
    expect(new ZitadelReleaseChannel("1.0.0", environment).isDisabled()).toBe(disabled);
  });
});
