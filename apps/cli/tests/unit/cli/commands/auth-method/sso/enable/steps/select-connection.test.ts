import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { SelectConnection } from "@/cli/commands/auth-method/sso/enable/steps/select-connection";
import { ConfigError, ConflictError } from "@/lib/zitadel";
import { asker } from "@/lib/input";
import { aConfig, aStore, anOidcConnection } from "@tests/helpers/config";
import { CUSTOMERS_PROJECT, CUSTOMERS_SCHEMA } from "@tests/helpers/connections";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * What the step reads from the steps before it.
 */
type Needs = Parameters<SelectConnection["run"]>[0];

/**
 * The file the `acme-sso` connection is read from.
 */
const ACME_SSO_FILE = ".zitadel/idps/acme-sso.json";

/**
 * The step, asking nothing: every setting is given, or read from the file.
 */
const STEP = new SelectConnection({
  ask: asker({
    interactive: false,
    force: false,
    stdin: Object.assign(Readable.from([]), { isTTY: true }),
  }),
  dryRun: false,
});

/**
 * What the step reads for a project holding an `acme-sso` connection.
 *
 * @param stored - The connection as its file holds it.
 * @param values - The custom settings the flags gave.
 * @returns What the step reads.
 */
function needsFor(
  stored: ReturnType<typeof anOidcConnection>,
  values: NonNullable<Needs["choice"]>["values"] = { slug: "acme-sso" },
): Needs {
  const documents = { ...CUSTOMERS_PROJECT, connections: { "acme-sso.json": stored } };
  return {
    flags: {} as Needs["flags"],
    choice: { selection: undefined, values },
    target: {
      cwd: "/tmp/app",
      config: aConfig(documents),
      store: aStore(documents),
      schema: CUSTOMERS_SCHEMA,
      schemaFlag: "customers",
      schemaGiven: undefined,
    },
  };
}

describe("SelectConnection for a custom connection a person finishes", () => {
  it("takes the display name and issuer the file holds", async () => {
    const { selection } = await STEP.run(needsFor(anOidcConnection({ slug: "acme-sso" })));

    expect(selection).toMatchObject({
      kind: "custom",
      connection: { displayName: "Acme", issuer: "https://sso.acme.example" },
    });
  });

  describe("when the run was given a setting", () => {
    it("leaves it out without reading the file's", async () => {
      const { selection } = await STEP.run(
        needsFor(anOidcConnection({ slug: "acme-sso", display_name: "   " }), {
          slug: "acme-sso",
          displayName: "Acme SSO",
        }),
      );

      expect(selection).toMatchObject({
        connection: { displayName: "Acme SSO", issuer: "https://sso.acme.example" },
      });
    });
  });

  describe("when a stored setting cannot be used", () => {
    it("refuses a display name a typed answer could not be, naming the file", async () => {
      const error = await rejectionOf(() => {
        return STEP.run(needsFor(anOidcConnection({ slug: "acme-sso", display_name: "   " })));
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          `${ACME_SSO_FILE} holds a display name that cannot be used: `,
        ),
        hint: "Fix it in that file, or choose another slug.",
        details: { file: ACME_SSO_FILE, slug: "acme-sso" },
      });
    });
  });

  describe("when the file has no issuer", () => {
    it("refuses it as no OIDC connection when no issuer was given", async () => {
      const error = await rejectionOf(() => {
        return STEP.run(
          needsFor(
            { slug: "acme-sso", protocol: "oidc", display_name: "Acme" },
            { slug: "acme-sso" },
          ),
        );
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection`,
        hint: "Fix the file, or choose another slug, then run the command again.",
      });
    });

    it("refuses it as no OIDC connection to the issuer that was given", async () => {
      const error = await rejectionOf(() => {
        return STEP.run(
          needsFor(
            { slug: "acme-sso", protocol: "oidc", display_name: "Acme" },
            { slug: "acme-sso", issuer: "https://sso.acme.example" },
          ),
        );
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection to https://sso.acme.example`,
      });
    });
  });
});
