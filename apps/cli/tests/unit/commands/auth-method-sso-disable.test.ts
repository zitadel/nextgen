import { describe, expect } from "vitest";

import {
  aFlowOffering,
  aProject,
  aSchema,
  authMethodJson,
  authMethodText,
  DEFAULT_SCHEMA,
  DONE_STEP,
  IDENTIFIER_STEP,
  LOGIN_FLOW_FILE,
  PASSWORD_STEP,
  SCHEMA_FILE,
  SUBMIT_ACTION,
  writeProject,
} from "@tests/helpers/auth-method";
import { authMethods, type ConfigDocuments } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { readJson } from "@tests/helpers/local-project";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "@tests/helpers/run-cli";

/**
 * A schema that signs in with a password or with Google.
 */
const PASSWORD_AND_GOOGLE = {
  password: { enabled: true },
  sso: { enabled: true, providers: ["google"] },
};

/**
 * A schema whose only way to sign in is Google.
 */
const GOOGLE_ONLY = { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } };

/**
 * Where a schema records its SSO providers.
 */
const SSO_ENTRY = ["x-auth-methods", "sso"];

/**
 * Where a login flow's entry step lists the providers it offers.
 */
const ENTRY_PROVIDERS = ["steps", 0, "sso_providers"];

/**
 * Where the default schema and its login flow offer Google, and what each holds
 * there until a run changes it.
 */
const GOOGLE_OFFERED_IN = [
  { file: SCHEMA_FILE, property: SSO_ENTRY, unchanged: PASSWORD_AND_GOOGLE.sso },
  { file: LOGIN_FLOW_FILE, property: ENTRY_PROVIDERS, unchanged: ["google"] },
];

/**
 * Where the second schema of a Project lives.
 */
const STAFF_SCHEMA_FILE = ".zitadel/schemas/staff.json";

/**
 * Where the Google connection lives.
 */
const GOOGLE_CONNECTION_FILE = ".zitadel/idps/google.json";

/**
 * The Google connection `sso enable` writes, naming its credentials as project
 * variables.
 */
const GOOGLE_CONNECTION = {
  slug: "google",
  protocol: "oidc",
  display_name: "Google",
  oidc: {
    issuer: "https://accounts.google.com",
    client_id: "${{ GOOGLE_CLIENT_ID }}",
    client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
  },
};

/**
 * The Google connection with no `oidc` block, which leaves both credential
 * variables to its slug.
 */
const GOOGLE_CONNECTION_BY_SLUG = {
  slug: GOOGLE_CONNECTION.slug,
  protocol: GOOGLE_CONNECTION.protocol,
  display_name: GOOGLE_CONNECTION.display_name,
};

/**
 * A GitHub connection, naming credential variables of its own.
 */
const GITHUB_CONNECTION = {
  slug: "github",
  protocol: "oidc",
  display_name: "GitHub",
  oidc: {
    issuer: "https://github.com",
    client_id: "${{ GITHUB_CLIENT_ID }}",
    client_secret: "${{ GITHUB_CLIENT_SECRET }}",
  },
};

/**
 * The notice that the Google connection and both its variables stay.
 */
const CONNECTION_KEPT =
  ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay, " +
  "so enabling google again does not ask for its credentials. Deploys publish the connection until " +
  "you delete the file; the server keeps it either way, as deleting a connection is not supported yet.";

/**
 * The notice that the steps `sso enable` added stay in the login flow.
 */
const STEPS_KEPT =
  "The steps register-sso and sso-conflict stay in .zitadel/flows/default-human-user-login.json " +
  "for the next provider you enable.";

/**
 * The warning for a schema left with no way to sign in.
 */
const LEFT_WITHOUT_SIGN_IN =
  "default-human-user is left with no way to sign in. Its users can only be managed through the API.";

/**
 * The warning a dry run gives for a schema that would be left with no way to sign in.
 */
const WOULD_BE_LEFT_WITHOUT_SIGN_IN =
  "default-human-user would be left with no way to sign in. Its users can only be managed through the API.";

/**
 * The refusal of a provider the schema neither offers nor has a connection for.
 */
const UNKNOWN_PROVIDER = "default-human-user has no provider named gogle";

/**
 * The refusal of a change a login flow cannot be checked against.
 */
const UNCHECKABLE_FLOW = "cannot be checked against the changed schema";

/**
 * A login flow whose login purpose names a step that does not exist, so it
 * cannot be checked.
 */
const BROKEN_FLOW = { ...aFlowOffering(["google"]), purposes: { login: "missing" } };

/**
 * The flow `sso enable` leaves: providers on the entry step, and the steps it
 * adds for a user it does not know and a user who already exists.
 *
 * @param providers - The providers the flow offers.
 * @returns The flow document.
 */
function anEnabledFlow(providers: readonly string[]) {
  return {
    ...aFlowOffering(providers),
    steps: [
      {
        ...IDENTIFIER_STEP,
        sso_providers: providers,
        transitions: {
          ...IDENTIFIER_STEP.transitions,
          sso_authenticated: { target: "done" },
          sso_user_not_found: { target: "register-sso" },
          user_already_exists: { target: "sso-conflict" },
        },
      },
      PASSWORD_STEP,
      {
        name: "register-sso",
        fields: ["email"],
        actions: [SUBMIT_ACTION],
        on_success: "create_user_with_sso",
        transitions: { submit: { target: "done" } },
      },
      {
        name: "sso-conflict",
        fields: ["x-auth-methods#password"],
        actions: [SUBMIT_ACTION],
        sso_providers: providers,
        transitions: {
          submit: { target: "done" },
          sso_authenticated: { target: "done" },
          sso_user_not_found: { target: "register-sso" },
        },
      },
      DONE_STEP,
    ],
  };
}

/**
 * A Project as `sso enable` leaves it for these providers, with the Google
 * connection beside it.
 *
 * @param providers - The providers the schema and its flow offer.
 * @returns The documents.
 */
function anEnabledProject(providers: readonly string[]): ConfigDocuments {
  return {
    ...aProject(
      { password: { enabled: true }, sso: { enabled: true, providers } },
      anEnabledFlow(providers),
    ),
    connections: { "google.json": GOOGLE_CONNECTION },
  };
}

/**
 * A Project that offers Google from its schema and its flow.
 */
const GOOGLE_OFFERED = aProject(PASSWORD_AND_GOOGLE, aFlowOffering(["google"]));

/**
 * A Project that offers Google, beside a GitHub connection the schema does not
 * offer.
 */
const GITHUB_NOT_OFFERED: ConfigDocuments = {
  ...GOOGLE_OFFERED,
  connections: { "github.json": GITHUB_CONNECTION },
};

describe("auth-method sso disable", () => {
  describe("when the schema offers the provider", () => {
    it("removes the provider from the schema", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

      expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, { enabled: false });
    });

    it("removes the provider from the flow", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

      expect(await readJson(dir, LOGIN_FLOW_FILE)).not.toHaveProperty(ENTRY_PROVIDERS);
    });

    it("reports the files it changed and what is left", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          method: "sso",
          provider: "google",
          changed: [SCHEMA_FILE, LOGIN_FLOW_FILE],
          usable: ["password"],
        },
      });
    });

    it("lists a dry run and a deploy, with --cwd, as the next commands", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_args: [
            ["deploy", "--dry-run", "--cwd", dir],
            ["deploy", "-m", "<what changed>", "--cwd", dir],
          ],
        },
      });
    });

    it("warns when the schema is left with methods no flow offers", async ({ dir }) => {
      const googleAlone = {
        ...aFlowOffering(["google"]),
        steps: [
          {
            name: "identifier",
            sso_providers: ["google"],
            transitions: { sso_authenticated: { target: "done" } },
          },
          DONE_STEP,
        ],
      };
      await writeProject(dir, aProject(PASSWORD_AND_GOOGLE, googleAlone));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        warnings: [
          "No login flow for default-human-user offers a method it enables, so nobody can sign in until one does.",
        ],
      });
    });
  });

  describe("with other providers", () => {
    const twoProviders = aProject(
      { password: { enabled: true }, sso: { enabled: true, providers: ["google", "github"] } },
      aFlowOffering(["google", "github"]),
    );

    it.for([
      { file: SCHEMA_FILE, property: SSO_ENTRY, kept: { enabled: true, providers: ["github"] } },
      { file: LOGIN_FLOW_FILE, property: ENTRY_PROVIDERS, kept: ["github"] },
    ])("keeps the other providers in $file", async ({ file, property, kept }, { dir }) => {
      await writeProject(dir, twoProviders);

      await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

      expect(await readJson(dir, file)).toHaveProperty(property, kept);
    });
  });

  describe("with --dry-run", () => {
    it("reports a skipped preview", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
      );

      expect(parseJson(result.stdout)).toMatchObject({ status: "skipped", reason: "dry-run" });
    });

    it.for(GOOGLE_OFFERED_IN)(
      "leaves $file as it was",
      async ({ file, property, unchanged }, { dir }) => {
        await writeProject(dir, GOOGLE_OFFERED);

        await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
        );

        expect(await readJson(dir, file)).toHaveProperty(property, unchanged);
      },
    );

    it("lists the files it would change", async ({ dir }) => {
      await writeProject(dir, GOOGLE_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: { changed: [SCHEMA_FILE, LOGIN_FLOW_FILE] },
      });
    });
  });

  describe("when the schema no longer lists the provider", () => {
    const flowOnly = aProject(authMethods("password"), aFlowOffering(["google"]));

    it("reports only the flow as changed", async ({ dir }) => {
      await writeProject(dir, flowOnly);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({ data: { changed: [LOGIN_FLOW_FILE] } });
    });

    it("removes the provider from the flow", async ({ dir }) => {
      await writeProject(dir, flowOnly);

      await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

      expect(await readJson(dir, LOGIN_FLOW_FILE)).not.toHaveProperty(ENTRY_PROVIDERS);
    });

    it("says it changed only the login flows", async ({ dir }) => {
      await writeProject(dir, flowOnly);

      const result = await runCliForTest(
        authMethodText(dir, "sso", "disable", "--provider", "google"),
      );

      expect(result.stdout).toContain("Removed google from the login flows of default-human-user");
    });
  });

  describe("with --schema", () => {
    const twoSchemas: ConfigDocuments = {
      schemas: {
        "default-human-user.json": aSchema(PASSWORD_AND_GOOGLE),
        "staff.json": aSchema(PASSWORD_AND_GOOGLE, "staff"),
      },
      flows: {
        "default-human-user-login.json": aFlowOffering(["google"]),
        "staff-login.json": aFlowOffering(["google"], "staff"),
      },
    };

    it("changes the named schema", async ({ dir }) => {
      await writeProject(dir, twoSchemas);

      await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--schema", "staff"),
      );

      expect(await readJson(dir, STAFF_SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, {
        enabled: false,
      });
    });

    it.for(GOOGLE_OFFERED_IN)(
      "leaves the other schema's $file alone",
      async ({ file, property, unchanged }, { dir }) => {
        await writeProject(dir, twoSchemas);

        await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--schema", "staff"),
        );

        expect(await readJson(dir, file)).toHaveProperty(property, unchanged);
      },
    );
  });

  describe("with a provider that has a connection the schema does not offer", () => {
    it("succeeds", async ({ dir }) => {
      await writeProject(dir, GITHUB_NOT_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "github"),
      );

      expect(result.exitCode).toBe(0);
    });

    it("changes nothing", async ({ dir }) => {
      await writeProject(dir, GITHUB_NOT_OFFERED);

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "github"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: { changed: [], next_commands: [] },
      });
    });

    it("says once that nothing changed", async ({ dir }) => {
      await writeProject(dir, GITHUB_NOT_OFFERED);

      const result = await runCliForTest(
        authMethodText(dir, "sso", "disable", "--provider", "github"),
      );

      expect(
        (result.stdout + result.stderr).split(
          "default-human-user does not offer github, so nothing changed",
        ),
      ).toHaveLength(2);
    });
  });

  describe("when sso enable left a connection and steps behind", () => {
    it("names the connection file, its variables and the steps it kept", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          notices: [
            { severity: "info", message: CONNECTION_KEPT },
            { severity: "info", message: STEPS_KEPT },
          ],
        },
      });
    });

    it("keeps the connection file as it was", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

      expect(await readJson(dir, GOOGLE_CONNECTION_FILE)).toEqual(GOOGLE_CONNECTION);
    });

    it("says how to remove the connection: the file first, then its variables", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_actions: [
            "To stop publishing the connection, delete .zitadel/idps/google.json before the deploy below.",
            "Once that deploy is live, remove its credentials: " +
              `\`${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_ID --cwd ${dir}`)}\` and ` +
              `\`${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_SECRET --cwd ${dir}`)}\``,
          ],
        },
      });
    });

    it("aims the variable rm commands at the environment the run named", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--env", "production"),
      );

      expect(parseJson(result.stdout)).toHaveProperty(
        ["data", "next_actions", 1],
        "Once that deploy is live, remove its credentials: " +
          `\`${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_ID --env production --cwd ${dir}`)}\` and ` +
          `\`${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_SECRET --env production --cwd ${dir}`)}\``,
      );
    });

    it.for([
      ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay",
      "deleting a connection is not supported yet",
      "The steps register-sso and sso-conflict stay in .zitadel/flows/default-human-user-login.json",
    ])("says in its text output: %s", async (said, { dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      const result = await runCliForTest(
        authMethodText(dir, "sso", "disable", "--provider", "google"),
      );

      expect(result.stdout + result.stderr).toContain(said);
    });

    it("does not name the steps while another provider still uses them", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google", "github"]));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: { notices: [{ message: CONNECTION_KEPT }] },
      });
    });

    describe("when another schema offers the provider", () => {
      const enabled = anEnabledProject(["google"]);
      const sharedBySchema: ConfigDocuments = {
        ...enabled,
        schemas: { ...enabled.schemas, "staff.json": aSchema(PASSWORD_AND_GOOGLE, "staff") },
      };

      it("says the connection stays", async ({ dir }) => {
        await writeProject(dir, sharedBySchema);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--schema", DEFAULT_SCHEMA),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          data: {
            notices: expect.arrayContaining([
              expect.objectContaining({
                message:
                  ".zitadel/idps/google.json stays: google is still offered by .zitadel/schemas/staff.json.",
              }),
            ]),
          },
        });
      });

      it("gives no way to remove the connection", async ({ dir }) => {
        await writeProject(dir, sharedBySchema);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--schema", DEFAULT_SCHEMA),
        );

        expect(parseJson(result.stdout)).not.toHaveProperty(["data", "next_actions"]);
      });
    });

    it("keeps the connection while another schema's flow still offers it", async ({ dir }) => {
      const enabled = anEnabledProject(["google"]);
      await writeProject(dir, {
        ...enabled,
        schemas: { ...enabled.schemas, "staff.json": aSchema(authMethods("password"), "staff") },
        flows: { ...enabled.flows, "staff-login.json": aFlowOffering(["google"], "staff") },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--schema", DEFAULT_SCHEMA),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          notices: expect.arrayContaining([
            expect.objectContaining({
              message:
                ".zitadel/idps/google.json stays: google is still offered by .zitadel/flows/staff-login.json.",
            }),
          ]),
        },
      });
    });

    it("says what it would keep on a dry run", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        status: "skipped",
        data: {
          notices: expect.arrayContaining([expect.objectContaining({ message: CONNECTION_KEPT })]),
        },
      });
    });

    it("writes nothing on a dry run", async ({ dir }) => {
      await writeProject(dir, anEnabledProject(["google"]));

      await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
      );

      expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, PASSWORD_AND_GOOGLE.sso);
    });

    it("leaves out a variable another connection still names", async ({ dir }) => {
      const enabled = anEnabledProject(["google"]);
      await writeProject(dir, {
        ...enabled,
        connections: {
          ...enabled.connections,
          "other.json": {
            ...GOOGLE_CONNECTION,
            slug: "other",
            oidc: { ...GOOGLE_CONNECTION.oidc, client_secret: "${{ OTHER_CLIENT_SECRET }}" },
          },
        },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          notices: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining(
                ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_SECRET stay,",
              ),
            }),
          ]),
        },
      });
    });

    it("names a credential variable the file leaves to its slug", async ({ dir }) => {
      await writeProject(dir, {
        ...anEnabledProject(["google"]),
        connections: { "google.json": GOOGLE_CONNECTION_BY_SLUG },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          notices: expect.arrayContaining([expect.objectContaining({ message: CONNECTION_KEPT })]),
        },
      });
    });

    describe("when a connection file is not valid JSON", () => {
      const invalid = { ".zitadel/idps/acme.json": "{,}" };

      it("refuses, naming the file", async ({ dir }) => {
        await writeProject(dir, anEnabledProject(["google"]), invalid);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          status: "error",
          code: "E_VALIDATION",
          message:
            "1 configuration file is not valid:\n  - .zitadel/idps/acme.json: cannot be parsed: invalid JSON at line 1, column 2",
        });
      });

      it("writes nothing", async ({ dir }) => {
        await writeProject(dir, anEnabledProject(["google"]), invalid);

        await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

        expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, PASSWORD_AND_GOOGLE.sso);
      });
    });

    it("does not name the steps of a flow it did not change", async ({ dir }) => {
      const enabled = anEnabledProject(["google"]);
      await writeProject(dir, {
        ...enabled,
        flows: {
          ...enabled.flows,
          "default-human-user-signup.json": {
            ...anEnabledFlow([]),
            name: "default-human-user-signup",
          },
        },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        data: { notices: [{ message: CONNECTION_KEPT }, { message: STEPS_KEPT }] },
      });
    });

    it("reports nothing kept when it changed nothing", async ({ dir }) => {
      const enabled = anEnabledProject(["google"]);
      await writeProject(dir, {
        ...enabled,
        connections: { ...enabled.connections, "github.json": GITHUB_CONNECTION },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "github"),
      );

      expect(parseJson(result.stdout)).toMatchObject({ data: { notices: [] } });
    });
  });

  describe("when it refuses", () => {
    describe("with a provider nothing offers and no connection names", () => {
      const googleConnected: ConfigDocuments = {
        ...GOOGLE_OFFERED,
        connections: { "google.json": GOOGLE_CONNECTION },
      };

      it("refuses it", async ({ dir }) => {
        await writeProject(dir, googleConnected);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "gogle"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          code: "E_NOT_FOUND",
          message: UNKNOWN_PROVIDER,
        });
      });

      it("refuses it on a dry run too", async ({ dir }) => {
        await writeProject(dir, googleConnected);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "gogle", "--dry-run"),
        );

        expect(parseJson(result.stdout)).toMatchObject({ status: "error", code: "E_NOT_FOUND" });
      });

      it.for([
        { case: "a run", flags: [] },
        { case: "a dry run", flags: ["--dry-run"] },
      ])("exits 4 on $case", async ({ flags }, { dir }) => {
        await writeProject(dir, googleConnected);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "gogle", ...flags),
        );

        expect(result.exitCode).toBe(4);
      });

      it("writes nothing", async ({ dir }) => {
        await writeProject(dir, googleConnected);

        await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "gogle"));

        expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, PASSWORD_AND_GOOGLE.sso);
      });
    });

    it("asks for a provider and names the ones offered", async ({ dir }) => {
      await writeProject(
        dir,
        aProject(
          { password: { enabled: true }, sso: { enabled: true, providers: ["github"] } },
          aFlowOffering(["github"]),
        ),
      );

      const result = await runCliForTest(authMethodJson(dir, "sso", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        message: "Name the provider to remove",
        hint: expect.stringContaining("default-human-user offers: github."),
      });
    });

    it("says when the schema offers no provider at all", async ({ dir }) => {
      await writeProject(dir, aProject(authMethods("password"), aFlowOffering([])));

      const result = await runCliForTest(authMethodJson(dir, "sso", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        hint: expect.stringContaining("default-human-user offers: none."),
      });
    });

    describe("when it would remove the last way to sign in", () => {
      const googleOnly = aProject(GOOGLE_ONLY, aFlowOffering(["google"]));

      it("refuses", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google"),
        );

        expect(parseJson(result.stdout)).toMatchObject({ code: "E_CONFIRMATION_REQUIRED" });
      });

      it("gives the --force re-run", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google"),
        );

        expect(parseJson(result.stdout)).toHaveProperty(
          ["details", "suggested_args", 0],
          [
            "auth-method",
            "sso",
            "disable",
            "--provider",
            "google",
            "--schema",
            DEFAULT_SCHEMA,
            "--cwd",
            dir,
            "--force",
          ],
        );
      });

      it("writes nothing", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

        expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, GOOGLE_ONLY.sso);
      });

      it("suggests enabling password or passkey instead", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          next_commands: [
            expectedPublicCliCommand(
              `auth-method sso disable --provider google --schema default-human-user --cwd ${dir} --force`,
            ),
            expectedPublicCliCommand(
              `auth-method password enable --schema default-human-user --cwd ${dir}`,
            ),
            expectedPublicCliCommand(
              `auth-method passkey enable --schema default-human-user --cwd ${dir}`,
            ),
          ],
        });
      });

      it("removes it with --force", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--force"),
        );

        expect(parseJson(result.stdout)).toMatchObject({ status: "ok" });
      });

      it("warns with --force that nobody can sign in", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--force"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          warnings: expect.arrayContaining([LEFT_WITHOUT_SIGN_IN]),
        });
      });

      it("refuses on a dry run, as the real run does", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          code: "E_CONFIRMATION_REQUIRED",
          message: ".zitadel/schemas/default-human-user.json would have no way to sign in left",
        });
      });

      it("keeps the --force re-run of a dry run a preview, and the alternatives real", async ({
        dir,
      }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          details: {
            suggested_args: [
              [
                "auth-method",
                "sso",
                "disable",
                "--provider",
                "google",
                "--schema",
                DEFAULT_SCHEMA,
                "--cwd",
                dir,
                "--force",
                "--dry-run",
              ],
              ["auth-method", "password", "enable", "--schema", DEFAULT_SCHEMA, "--cwd", dir],
              ["auth-method", "passkey", "enable", "--schema", DEFAULT_SCHEMA, "--cwd", dir],
            ],
          },
        });
      });

      it("previews it on a forced dry run, and warns", async ({ dir }) => {
        await writeProject(dir, googleOnly);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--dry-run", "--force"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          status: "skipped",
          reason: "dry-run",
          warnings: [WOULD_BE_LEFT_WITHOUT_SIGN_IN],
        });
      });
    });

    describe("when a flow has errors that prevent checking it", () => {
      const broken = aProject(PASSWORD_AND_GOOGLE, BROKEN_FLOW);

      it("refuses", async ({ dir }) => {
        await writeProject(dir, broken);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          message: expect.stringContaining(UNCHECKABLE_FLOW),
        });
      });

      it("writes nothing", async ({ dir }) => {
        await writeProject(dir, broken);

        await runCliForTest(authMethodJson(dir, "sso", "disable", "--provider", "google"));

        expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(SSO_ENTRY, PASSWORD_AND_GOOGLE.sso);
      });

      it("does not let --force past it", async ({ dir }) => {
        await writeProject(dir, broken);

        const result = await runCliForTest(
          authMethodJson(dir, "sso", "disable", "--provider", "google", "--force"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          message: expect.stringContaining(UNCHECKABLE_FLOW),
        });
      });
    });

    it("refuses a schema that points at an external url", async ({ dir }) => {
      await writeProject(dir, {
        schemas: {
          "default-human-user.json": {
            kind: "schema-url",
            url: "https://schemas.test.invalid/customers.json",
          },
        },
        flows: { "default-human-user-login.json": aFlowOffering(["google"]) },
      });

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        message: ".zitadel/schemas/default-human-user.json points at an external schema",
      });
    });

    it("refuses a project holding a file its contract refuses, naming the file", async ({
      dir,
    }) => {
      await writeProject(dir, aProject([], aFlowOffering(["google"])));

      const result = await runCliForTest(
        authMethodJson(dir, "sso", "disable", "--provider", "google"),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        details: { problems: [expect.objectContaining({ path: SCHEMA_FILE })] },
      });
    });
  });
});
