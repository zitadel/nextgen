import { describe, expect, it } from "vitest";

import { idVariable, secretVariable } from "@tests/helpers/idp-values";
import { republishCommand, republishCommands, unpublished } from "@/lib/idp";
import { aSuggest } from "@tests/helpers/suggestions";

/** A run that named no environment. */
const NO_SELECTOR = aSuggest({}, "1.0.0-alpha.23");
/** A run with `--env production`. */
const PRODUCTION = aSuggest({ env: "production" }, "1.0.0-alpha.23");

describe("the recovery command for a credential", () => {
  it("is runnable rather than a bare subcommand", () => {
    // A JSON result is read by agents, which execute these as shell commands.
    expect(republishCommand(idVariable("google"), false, NO_SELECTOR)).toMatch(
      /^npx .+ variable set /,
    );
  });

  it("marks a secret as one, so the value is not stored in the clear", () => {
    expect(republishCommand(secretVariable("google"), true, NO_SELECTOR)).toContain(
      "variable set GOOGLE_CLIENT_SECRET --secret",
    );
    expect(republishCommand(idVariable("google"), false, NO_SELECTOR)).not.toContain("--secret");
  });

  it("carries the environment selector so the retry targets the same project", () => {
    // The selector reproduces the invocation's --env/--env-file/--server; a
    // retry without it would silently target the default project.
    expect(republishCommand(idVariable("google"), false, PRODUCTION)).toContain(
      "variable set GOOGLE_CLIENT_ID --env production",
    );
  });
});

describe("the recovery commands a result carries", () => {
  it("says nothing when the project received everything", () => {
    expect(
      republishCommands(
        [
          { name: idVariable("google"), secret: false, published: "stored" },
          { name: secretVariable("google"), secret: true, published: "stored" },
        ],
        NO_SELECTOR,
      ),
    ).toEqual([]);
  });

  it("names every credential that did not land, and only those", () => {
    const commands = republishCommands(
      [
        { name: idVariable("google"), secret: false, published: "stored" },
        { name: secretVariable("google"), secret: true, published: "failed" },
      ],
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
        [{ name: idVariable("google"), secret: false, published: "deferred" }],
        NO_SELECTOR,
      ),
    ).toHaveLength(1);
  });

  it("skips a credential this run never had", () => {
    // No provider was enabled, or no secret was supplied: there is nothing to
    // republish and a command naming an empty variable would be noise.
    expect(
      republishCommands([{ name: undefined, secret: false, published: "failed" }], NO_SELECTOR),
    ).toEqual([]);
    expect(
      republishCommands(
        [{ name: idVariable("google"), secret: false, published: undefined }],
        NO_SELECTOR,
      ),
    ).toEqual([]);
  });
});

describe("the credentials a recovery is for", () => {
  it("lists each credential that did not land, with whether it is a secret", () => {
    expect(
      unpublished([
        { name: idVariable("google"), secret: false, published: "failed" },
        { name: secretVariable("google"), secret: true, published: "deferred" },
        { name: secretVariable("acme"), secret: true, published: "stored" },
      ]),
    ).toEqual([
      { name: idVariable("google"), secret: false },
      { name: secretVariable("google"), secret: true },
    ]);
  });

  it("lists the same credentials as the commands", () => {
    const credentials = [
      { name: secretVariable("google"), secret: true, published: "failed" as const },
    ];

    expect(republishCommands(credentials, NO_SELECTOR)).toEqual(
      unpublished(credentials).map((missing) => {
        return republishCommand(missing.name, missing.secret, NO_SELECTOR);
      }),
    );
  });
});
