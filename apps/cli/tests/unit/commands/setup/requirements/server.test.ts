import { describe, expect, it } from "vitest";

import { server } from "../../../../../src/commands/setup/requirements/server";
import { requirementContext } from "../../../../helpers/requirement-context";

const meta = { cwd: "/nonexistent-zitadel-dir", cliVersion: "0.0.0-test" };

describe("server", () => {
  it("is the cloud when no server was named", async () => {
    const found = await server.resolve(requirementContext({ meta }));

    expect(found).toMatchObject({ origin: "default" });
  });

  it("is the server that was named", async () => {
    const found = await server.resolve(
      requirementContext({ meta: { ...meta, serverFlag: "https://acme.zitadel.cloud" } }),
    );

    expect(found).toMatchObject({ value: "https://acme.zitadel.cloud", origin: "flag" });
  });

  it("hands the refusal how to start the server and rerun when `--server local` has none", async () => {
    const found = await server.resolve(
      requirementContext({
        flags: { framework: "next", nonInteractive: true },
        meta: { ...meta, serverFlag: "local" },
      }),
    );

    expect(found).toMatchObject({
      unmet: {
        setup: "setup --framework next --non-interactive --server local",
      },
    });
    expect(server.refusal).toMatchObject({
      code: "E_LOCAL_SERVER_NOT_RUNNING",
      next: ["start", "{setup}"],
    });
  });
});
