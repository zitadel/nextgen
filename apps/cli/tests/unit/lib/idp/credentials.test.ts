import { describe, expect, it } from "vitest";

import { republishCommand, republishCommands } from "../../../../src/lib/idp";

const VERSION = "1.0.0-alpha.23";

describe("the recovery command for a credential", () => {
  it("names the owner, without which every variables command refuses", () => {
    // `variables set NAME` alone fails with "Name the owner: --project-level"
    // before making a request, so the recovery step would repair nothing.
    expect(republishCommand("GOOGLE_CLIENT_ID", false, VERSION)).toContain("--project-level");
  });

  it("is runnable rather than a bare subcommand", () => {
    // A JSON result is read by agents, which execute these as shell commands.
    expect(republishCommand("GOOGLE_CLIENT_ID", false, VERSION)).toMatch(/^npx .+ variables set /);
  });

  it("marks a secret as one, so the value is not stored in the clear", () => {
    expect(republishCommand("GOOGLE_CLIENT_SECRET", true, VERSION)).toContain(
      "variables set GOOGLE_CLIENT_SECRET --project-level --secret",
    );
    expect(republishCommand("GOOGLE_CLIENT_ID", false, VERSION)).not.toContain("--secret");
  });
});

describe("the recovery commands a result carries", () => {
  it("says nothing when the project received everything", () => {
    expect(
      republishCommands(
        [
          { name: "GOOGLE_CLIENT_ID", secret: false, published: "stored" },
          { name: "GOOGLE_CLIENT_SECRET", secret: true, published: "stored" },
        ],
        VERSION,
      ),
    ).toEqual([]);
  });

  it("names every credential that did not land, and only those", () => {
    const commands = republishCommands(
      [
        { name: "GOOGLE_CLIENT_ID", secret: false, published: "stored" },
        { name: "GOOGLE_CLIENT_SECRET", secret: true, published: "failed" },
      ],
      VERSION,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("variables set GOOGLE_CLIENT_SECRET --project-level --secret");
  });

  it("covers a deferred publish, not just a failed one", () => {
    // Deferred means the value never reached the project either; the button
    // fails at token exchange just the same.
    expect(
      republishCommands(
        [{ name: "GOOGLE_CLIENT_ID", secret: false, published: "deferred" }],
        VERSION,
      ),
    ).toHaveLength(1);
  });

  it("skips a credential this run never had", () => {
    // No provider was enabled, or no secret was supplied: there is nothing to
    // republish and a command naming an empty variable would be noise.
    expect(
      republishCommands([{ name: undefined, secret: false, published: "failed" }], VERSION),
    ).toEqual([]);
    expect(
      republishCommands(
        [{ name: "GOOGLE_CLIENT_ID", secret: false, published: undefined }],
        VERSION,
      ),
    ).toEqual([]);
  });
});
