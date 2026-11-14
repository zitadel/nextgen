import { Readable } from "node:stream";

import { idpProvider, type ProviderSelection } from "@zitadel/config/idp";
import { describe, expect, it } from "vitest";

import { CollectCredentials } from "@/cli/commands/auth-method/sso/enable/steps/collect-credentials";
import { ZitadelError } from "@/lib/errors";
import { CredentialDelivery, NO_CLAIM_REQUEST } from "@/lib/idp";
import { asker } from "@/lib/input";
import type { Questions } from "@/lib/ui";
import { Connection } from "@/lib/zitadel";
import { aConfig } from "@tests/helpers/config";
import { anAcmeSsoProvider, CUSTOMERS_PROJECT, CUSTOMERS_SCHEMA } from "@tests/helpers/connections";
import {
  acmeSelection,
  clientId,
  clientSecret,
  googleSelection,
  secretVariable,
} from "@tests/helpers/idp-values";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * What the step reads from the steps before it.
 */
type Needs = Parameters<CollectCredentials["run"]>[0];

/**
 * What the step is given by the command.
 */
type Deps = ConstructorParameters<typeof CollectCredentials>[0];

/**
 * The Google connection the CLI would write for the `customers` schema.
 */
const GOOGLE = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA);

/**
 * The `acme-sso` connection the CLI would write for the `customers` schema.
 */
const ACME_SSO = Connection.forProvider(anAcmeSsoProvider(), CUSTOMERS_SCHEMA);

/**
 * The `customers` project without a connection.
 */
const BARE = aConfig(CUSTOMERS_PROJECT);

/**
 * The `customers` project with Google enabled.
 */
const WITH_GOOGLE = BARE.connections.enable(CUSTOMERS_SCHEMA, GOOGLE).after;

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
 * What the step is given by the command.
 *
 * @param overrides - What differs from a published build asking by a pipe.
 * @returns What the command gives the step.
 */
function depsFor(overrides: Partial<Deps> = {}): Deps {
  return {
    ask: asking("shh\n"),
    developmentBuild: false,
    suggest: aSuggest({}, "1.0.0"),
    ...overrides,
  };
}

/**
 * What the step reads for a connection.
 *
 * @param input - Which provider, whether its connection is already in the
 *   project, and what `--client-id` gave.
 * @param input.selection - The provider the run adds.
 * @param input.reused - Whether the connection was already in the project.
 * @param input.claimRequest - The claims the run was given.
 * @param input.clientId - The client id `--client-id` gave, if any.
 * @returns What the step reads.
 */
function needsFor(
  input: {
    selection?: ProviderSelection;
    reused?: boolean;
    claimRequest?: Needs["claimRequest"];
    clientId?: Needs["flags"]["clientId"];
  } = {},
): Needs {
  const selection = input.selection ?? googleSelection;
  const reused = input.reused ?? false;
  const connection = selection.kind === "custom" ? ACME_SSO : GOOGLE;
  const project = reused ? WITH_GOOGLE : BARE;
  const preview = project.connections.enable(CUSTOMERS_SCHEMA, connection);
  return {
    flags: { clientId: input.clientId } as Needs["flags"],
    selection,
    claimRequest: input.claimRequest ?? NO_CLAIM_REQUEST,
    preview,
    delivery: new CredentialDelivery({
      connection: preview.document,
      reused,
      suggest: aSuggest({}, "1.0.0"),
    }),
  };
}

describe("CollectCredentials for a new connection", () => {
  it("takes the client id from the flag and the secret from stdin", async () => {
    const { given } = await new CollectCredentials(depsFor()).run(
      needsFor({ clientId: clientId("abc") }),
    );

    expect(given).toEqual({
      endpoints: undefined,
      clientId: "abc",
      secret: clientSecret("shh"),
    });
  });

  it("refuses a run with no client id", async () => {
    const asked = new CollectCredentials(depsFor()).run(needsFor());

    await expect(asked).rejects.toBeInstanceOf(ZitadelError);
    await expect(asked).rejects.toMatchObject({ message: expect.stringContaining("client id") });
  });

  it("suggests the command that supplies the missing client id", async () => {
    const asked = new CollectCredentials(depsFor()).run(needsFor());

    await expect(asked).rejects.toMatchObject({
      nextCommands: [expect.stringContaining("auth-method sso enable --provider google")],
    });
  });

  it("repeats the claims the run was given in the command it suggests", async () => {
    const asked = new CollectCredentials(depsFor()).run(
      needsFor({
        claimRequest: {
          ...NO_CLAIM_REQUEST,
          entries: [{ attribute: "companyName", claim: "organization", type: undefined }],
          scopes: ["organization"],
        },
      }),
    );

    await expect(asked).rejects.toMatchObject({
      nextCommands: [
        expect.stringContaining("--claim companyName=organization --claim-scope organization"),
      ],
    });
  });

  it("refuses a run with no secret on stdin, naming the variable", async () => {
    const asked = new CollectCredentials(depsFor({ ask: asking(undefined) })).run(
      needsFor({ clientId: clientId("abc") }),
    );

    await expect(asked).rejects.toMatchObject({
      message: expect.stringContaining(secretVariable("google")),
    });
  });

  it("suggests no command for a custom connection, whose settings it cannot repeat", async () => {
    const asked = new CollectCredentials(depsFor()).run(needsFor({ selection: acmeSelection }));

    await expect(asked).rejects.toMatchObject({ nextCommands: undefined });
  });

  it("does not ask a custom connection where the provider answers", async () => {
    const { given } = await new CollectCredentials(depsFor({ developmentBuild: true })).run(
      needsFor({ selection: acmeSelection, clientId: clientId("abc") }),
    );

    expect(given.endpoints).toBeUndefined();
  });
});

describe("CollectCredentials for a reused connection", () => {
  it("asks for nothing the run was not given", async () => {
    const { given } = await new CollectCredentials(depsFor({ ask: asking(undefined) })).run(
      needsFor({ reused: true }),
    );

    expect(given).toEqual({ endpoints: undefined, clientId: undefined, secret: undefined });
  });

  it("keeps the client id the flag gave", async () => {
    const { given } = await new CollectCredentials(depsFor({ ask: asking(undefined) })).run(
      needsFor({ reused: true, clientId: clientId("abc") }),
    );

    expect(given.clientId).toBe("abc");
  });

  it("takes a secret piped on stdin, to replace the one the project holds", async () => {
    const { given } = await new CollectCredentials(depsFor()).run(needsFor({ reused: true }));

    expect(given.secret).toBe(clientSecret("shh"));
  });
});
