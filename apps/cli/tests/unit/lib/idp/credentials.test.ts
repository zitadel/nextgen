import { describe, expect, it } from "vitest";

import { idVariable, secretVariable } from "../../../helpers/idp-values";
import { republishArgs, republishCommand, republishCommands } from "../../../../src/lib/idp";
import { environmentSelectorSuffix } from "../../../../src/lib/oclif/environment-flags";

/** A run that named no environment. */
const NO_SELECTOR = environmentSelectorSuffix({});
/** A run with `--env production`. */
const PRODUCTION = environmentSelectorSuffix({ envName: "production" });

const VERSION = "1.0.0-alpha.23";

describe("the recovery command for a credential", () => {
  it("is runnable rather than a bare subcommand", () => {
    // A JSON result is read by agents, which execute these as shell commands.
    expect(republishCommand(idVariable("GOOGLE_CLIENT_ID"), false, VERSION, NO_SELECTOR)).toMatch(
      /^npx .+ variable set /,
    );
  });

  it("marks a secret as one, so the value is not stored in the clear", () => {
    expect(
      republishCommand(secretVariable("GOOGLE_CLIENT_SECRET"), true, VERSION, NO_SELECTOR),
    ).toContain("variable set GOOGLE_CLIENT_SECRET --secret");
    expect(
      republishCommand(idVariable("GOOGLE_CLIENT_ID"), false, VERSION, NO_SELECTOR),
    ).not.toContain("--secret");
  });

  it("carries the environment selector so the retry targets the same project", () => {
    // The selector reproduces the invocation's --env/--env-file/--server; a
    // retry without it would silently target the default project.
    expect(republishCommand(idVariable("GOOGLE_CLIENT_ID"), false, VERSION, PRODUCTION)).toContain(
      "variable set GOOGLE_CLIENT_ID --env production",
    );
  });
});

describe("the recovery commands a result carries", () => {
  it("says nothing when the project received everything", () => {
    expect(
      republishCommands(
        [
          { name: idVariable("GOOGLE_CLIENT_ID"), secret: false, published: "stored" },
          { name: secretVariable("GOOGLE_CLIENT_SECRET"), secret: true, published: "stored" },
        ],
        VERSION,
        NO_SELECTOR,
      ),
    ).toEqual([]);
  });

  it("names every credential that did not land, and only those", () => {
    const commands = republishCommands(
      [
        { name: idVariable("GOOGLE_CLIENT_ID"), secret: false, published: "stored" },
        { name: secretVariable("GOOGLE_CLIENT_SECRET"), secret: true, published: "failed" },
      ],
      VERSION,
      NO_SELECTOR,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("variable set GOOGLE_CLIENT_SECRET --secret");
  });

  it("covers a deferred publish, not just a failed one", () => {
    // Deferred means the value never reached the project either; the button
    // fails at token exchange just the same.
    expect(
      republishCommands(
        [{ name: idVariable("GOOGLE_CLIENT_ID"), secret: false, published: "deferred" }],
        VERSION,
        NO_SELECTOR,
      ),
    ).toHaveLength(1);
  });

  it("skips a credential this run never had", () => {
    // No provider was enabled, or no secret was supplied: there is nothing to
    // republish and a command naming an empty variable would be noise.
    expect(
      republishCommands(
        [{ name: undefined, secret: false, published: "failed" }],
        VERSION,
        NO_SELECTOR,
      ),
    ).toEqual([]);
    expect(
      republishCommands(
        [{ name: idVariable("GOOGLE_CLIENT_ID"), secret: false, published: undefined }],
        VERSION,
        NO_SELECTOR,
      ),
    ).toEqual([]);
  });
});

describe("the recovery commands as argument lists", () => {
  it("appends the extra arguments, such as the run's --cwd, to every command", () => {
    expect(
      republishArgs(
        [
          { name: idVariable("GOOGLE_CLIENT_ID"), secret: false, published: "failed" },
          { name: secretVariable("GOOGLE_CLIENT_SECRET"), secret: true, published: "deferred" },
        ],
        ["--cwd", "/home/dev/app"],
      ),
    ).toEqual([
      ["variable", "set", "GOOGLE_CLIENT_ID", "--cwd", "/home/dev/app"],
      ["variable", "set", "GOOGLE_CLIENT_SECRET", "--secret", "--cwd", "/home/dev/app"],
    ]);
  });

  it("lists the same commands as the strings", () => {
    const credentials = [
      { name: secretVariable("GOOGLE_CLIENT_SECRET"), secret: true, published: "failed" as const },
    ];

    expect(republishCommands(credentials, VERSION, NO_SELECTOR)).toEqual(
      republishArgs(credentials).map((args) =>
        expect.stringMatching(new RegExp(` ${args.join(" ")}$`)),
      ),
    );
  });
});
