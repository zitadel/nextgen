import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { asker } from "@/lib/input";
import type { Questions } from "@/lib/ui";
import { CredentialPrompt, type PromptRun } from "@/lib/idp";
import { aSuggest } from "@tests/helpers/suggest";
import { ZitadelError } from "@/lib/errors";
import {
  acmeSelection,
  clientId,
  clientSecret,
  googleSelection,
  secretVariable,
} from "@tests/helpers/idp-values";

/**
 * How a run asks: nobody to ask, so only a flag or a pipe answers.
 *
 * @param piped - What was piped in on stdin; `undefined` stands for a terminal.
 * @returns The asker.
 */
function asking(piped: string | undefined): Questions {
  const stdin =
    piped === undefined
      ? Object.assign(Readable.from([]), { isTTY: true })
      : Readable.from([piped]);
  return asker({ interactive: false, force: false, stdin });
}

/**
 * A prompt for a run.
 *
 * @param overrides - What differs from a new Google connection in a published build.
 * @returns The prompt.
 */
function promptFor(overrides: Partial<PromptRun> = {}): CredentialPrompt {
  return new CredentialPrompt({
    selection: googleSelection,
    reused: false,
    secretVariable: secretVariable("google"),
    ask: asking("shh\n"),
    developmentBuild: false,
    suggest: aSuggest({}, "1.0.0"),
    ...overrides,
  });
}

describe("CredentialPrompt.ask for a new connection", () => {
  it("takes the client id from the flag and the secret from stdin", async () => {
    const given = await promptFor().ask(clientId("abc"));

    expect(given).toEqual({
      endpoints: undefined,
      clientId: "abc",
      secret: clientSecret("shh"),
    });
  });

  it("refuses a run with no client id", async () => {
    const asked = promptFor().ask(undefined);

    await expect(asked).rejects.toBeInstanceOf(ZitadelError);
    await expect(asked).rejects.toMatchObject({ message: expect.stringContaining("client id") });
  });

  it("suggests the command that supplies the missing client id", async () => {
    const asked = promptFor().ask(undefined);

    await expect(asked).rejects.toMatchObject({
      nextCommands: [expect.stringContaining("auth-method sso enable --provider google")],
    });
  });

  it("refuses a run with no secret on stdin, naming the variable", async () => {
    const asked = promptFor({ ask: asking(undefined) }).ask(clientId("abc"));

    await expect(asked).rejects.toMatchObject({
      message: expect.stringContaining(secretVariable("google")),
    });
  });

  it("suggests no command for a custom connection, whose settings it cannot repeat", async () => {
    const asked = promptFor({ selection: acmeSelection }).ask(undefined);

    await expect(asked).rejects.toMatchObject({ nextCommands: undefined });
  });

  it("does not ask a custom connection where the provider answers", async () => {
    const given = await promptFor({ selection: acmeSelection, developmentBuild: true }).ask(
      clientId("abc"),
    );

    expect(given.endpoints).toBeUndefined();
  });
});

describe("CredentialPrompt.ask for a reused connection", () => {
  it("asks for nothing the run was not given", async () => {
    const given = await promptFor({ reused: true, ask: asking(undefined) }).ask(undefined);

    expect(given).toEqual({ endpoints: undefined, clientId: undefined, secret: undefined });
  });

  it("keeps the client id the flag gave", async () => {
    const given = await promptFor({ reused: true, ask: asking(undefined) }).ask(clientId("abc"));

    expect(given.clientId).toBe("abc");
  });

  it("takes a secret piped on stdin, to replace the one the project holds", async () => {
    const given = await promptFor({ reused: true }).ask(undefined);

    expect(given.secret).toBe(clientSecret("shh"));
  });
});
