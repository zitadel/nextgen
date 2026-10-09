import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { password, text } from "@clack/prompts";
import { consola } from "consola";

import { credentialVariables, idpProvider, IDP_PROVIDERS } from "@zitadel/config/idp";

import { createZitadelClient } from "../../../lib/api-client";
import { isDevelopmentBuild } from "../../../lib/build-channel";
import { ZitadelError } from "../../../lib/errors";
import { portableCommands } from "../../../lib/public-cli";
import { bailOnCancel } from "../../../lib/prompt-cancel";
import { stableStringify } from "../../../lib/json";
import {
  applySsoToFlow,
  applySsoToSchema,
  askConnectionEndpoints,
  callbackUriFor,
  CONNECTION_SCHEMA_REF,
  enabledMethods,
  type FlowFile,
  IDPS_DIR,
  credentialVariablesOf,
  planConnection,
  publishClientId,
  type PublishState,
  readConnectionFiles,
  readSchemaFiles,
  reportClientIdOutcome,
  type StoredVariables,
  ssoEditRefusal,
  type SsoEditTarget,
  type SsoResult,
  type SsoSkipped,
  reportSecretOutcome,
  selectSchema,
  storeClientSecret,
  type SchemaFile,
  type SecretOutcome,
  type SecretPublisher,
} from "../../../lib/idp";
import { CommandGroups, type JsonEnvelope, nonBlankString } from "../../../lib/oclif";
import {
  readDevelopmentIssuer,
  readZitadelConfig,
  readZitadelSecret,
  type ZitadelSecret,
} from "../../../lib/project";
import { flowsForSchema } from "../../../lib/schema-flows";
import { readStdin } from "../../../lib/variables";
import { reportWarning } from "../../../lib/warnings";
import {
  activeBodies,
  AuthMethodCommand,
  optionArgs,
  refuseBrokenFlows,
  refuseExternalSchema,
  SCHEMA_FLAG,
} from "../shared";

/**
 * The `auth-method sso enable` command (ADR 069) — add a provider to a
 * Project's sign-in methods. `sso enable` is its deprecated alias.
 *
 * One direct journey: the developer is told what to register with the
 * provider, gives back the credentials, and the Project's configuration is
 * written. It works on the local Project `zitadel setup` created and does not
 * require claiming, because this is the local development path.
 *
 * The client secret never comes from a flag, following `variables set`: it is
 * prompted for, or read from stdin when scripting, so it cannot land in shell
 * history, a process listing, or CI logs.
 */
export default class SsoEnable extends AuthMethodCommand {
  static override description = "Add an identity provider to a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method sso enable --provider google",
    "<%= config.bin %> auth-method sso enable --provider google --schema customers",
    "<%= config.bin %> auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
  ];
  static override flags = {
    // Not `required`: oclif's own "Missing required flag provider" is the one
    // refusal in this command that would carry no hint, and every other error
    // here names the next move. The check below does that instead.
    provider: Flags.string({
      options: [...IDP_PROVIDERS],
      description: "Identity provider to enable.",
    }),
    ...SCHEMA_FLAG,
    "client-id": nonBlankString({
      description: "Client id of the application registered with the provider.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SsoEnable);
    await this.toMeta(flags);
    const { cwd, nonInteractive, dryRun } = this.meta;

    const provider = flags.provider;
    if (provider === undefined) {
      // Named rather than prompted for: the catalog holds one provider today,
      // and a question offering a single answer is a keystroke, not a choice
      // (the same reasoning `OwnerCommand` gives for requiring an owner).
      throw new ZitadelError("E_VALIDATION", "Name the provider to enable", {
        hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
      });
    }
    const entry = idpProvider(provider);

    // The Project is read before anything is asked for: being turned away
    // after typing a secret would mean typing it again.
    const config = await readZitadelConfig(cwd);
    const secretFile = await readZitadelSecret(cwd);
    const issuer = readDevelopmentIssuer(config);
    if (issuer === undefined) {
      throw new ZitadelError("E_VALIDATION", "This Project has no development issuer", {
        hint: "Run `zitadel setup` first, or add environments.development.issuer to zitadel.json.",
      });
    }
    const callbackUri = callbackUriFor(issuer);

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    refuseExternalSchema(schema);
    const connections = await readConnectionFiles(cwd);
    // `nonBlankString` has already refused a blank one and trimmed the rest.
    const clientIdFlag = flags["client-id"];
    const plan = planConnection({ provider, files: connections, clientId: clientIdFlag });

    const reusing = plan.action === "reuse";
    // A reused connection may name its own variables — it is an editable file
    // — so the credentials go where it actually looks rather than where this
    // command would have put them. A name is `undefined` when the file holds
    // that credential as a literal: there is no variable to publish to, and
    // publishing to a derived name would report success for a value the
    // connection never reads.
    // What a newly written connection will reference: this command writes both
    // as `${{ NAME }}`, so on the create path the names are certain.
    const scaffolded = credentialVariables(plan.slug);
    const names: StoredVariables = reusing
      ? credentialVariablesOf(plan.file, plan.slug)
      : scaffolded;
    const variable = names.clientSecret;
    const idVariable = names.clientId;

    // Read-only, and before the dry-run return: a Project whose flows all name
    // another schema must fail identically either way, or the preview says
    // "would create" for a run that cannot succeed.
    const flows = await this.targetFlows(cwd, schema);
    // The schema and flow edits are worked out now, before the dry-run return
    // and before the connection is written or a credential published, so a
    // refusal (an edit the editors cannot make, or a flow `plan` would then
    // reject) stops the run with nothing changed (ADR 069 §3).
    const edits = planEdits(schema, plan.slug, flows);
    refuseBrokenFlows(
      schema,
      edits.schema.document as Record<string, unknown>,
      edits.flows.map(({ flow, result }) => ({
        file: flow,
        after: result.document as Record<string, unknown>,
      })),
    );
    // A follow-up run from where the user stands must reach the same Project.
    const cwdArgs = flags.cwd === undefined ? [] : optionArgs("--cwd", cwd);
    const outcome = {
      schema,
      before: schema.body,
      after: edits.schema.document as Record<string, unknown>,
      flowsAfter: activeBodies(
        edits.flows.map(({ result }) => result.document as Record<string, unknown>),
      ),
      notOffered: [],
    };

    consola.info(`Project   ${secretFile.project_id}`);
    consola.info(
      `Schema    ${schema.path}${schema.methods.length > 0 ? ` (${schema.methods.join(", ")})` : ""}`,
    );

    if (dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: this.payload({
          projectId: secretFile.project_id,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret: undefined,
          clientId: undefined,
          idVariable,
        }),
        pretty: `Would ${plan.action} ${plan.action === "reuse" ? plan.file.path : plan.path}`,
      });
    }
    // An existing connection is reused rather than rewritten, but the schema
    // and flow edits still run: those are the point of the command, they are
    // per-schema, and they are idempotent. Enabling the provider for a second
    // user type, and finishing a run interrupted after the connection file was
    // written, both arrive here.
    let secret: SecretOutcome | undefined;
    let clientIdState: PublishState | undefined;

    if (reusing) {
      consola.success(`Reusing ${plan.file.path}`);
      // The connection references its credentials rather than holding them, so
      // reuse is not evidence they were ever published: a run interrupted
      // between writing the file and publishing leaves the document pointing
      // at variables that do not exist. A supplied credential is published
      // again, which costs one call and makes the command idempotent --
      // rerunning with a changed client id now takes effect instead of being
      // silently ignored. Nothing is prompted for: an unattended rerun should
      // not start asking for credentials the project already has.
      const publish = this.publisher(secretFile);
      if (clientIdFlag !== undefined) {
        if (idVariable === undefined) {
          reportWarning(
            `${plan.file.path} holds its client id directly, so nothing was published. ` +
              "Edit the file to change it.",
          );
        } else {
          clientIdState = await publishClientId({
            name: idVariable,
            value: clientIdFlag,
            publish,
          });
        }
      }
      const piped = nonInteractive ? await this.pipedSecret() : undefined;
      if (piped !== undefined) {
        if (variable === undefined) {
          reportWarning(
            `${plan.file.path} holds its client secret directly, so nothing was published. ` +
              "Replace it with a ${{ NAME }} reference so the secret is not committed.",
          );
        } else {
          secret = await storeClientSecret({ name: variable, value: piped, publish });
        }
      }
    } else {
      consola.info(`${entry.displayName} needs an OAuth application.`);
      consola.info(`Callback URI   ${callbackUri}`);
      consola.info(`Create it at   ${entry.consoleUrl}`);

      // Before the credentials: on a development run (ZITADEL_CLI_DEV) the
      // provider may be a local stand-in, and the client is registered with
      // whatever answers.
      const endpoints = await askConnectionEndpoints({
        provider,
        developmentBuild: isDevelopmentBuild() && !nonInteractive,
        command: "Enable",
      });
      const clientId = clientIdFlag ?? (await this.askClientId(entry.displayName, nonInteractive));
      const secretValue = await this.askClientSecret(scaffolded.clientSecret, nonInteractive);

      const publish = this.publisher(secretFile);
      const connection = entry.connection({
        slug: plan.slug,
        schemaProperties: schema.properties,
        schemaRef: CONNECTION_SCHEMA_REF,
        endpoints,
      });
      if (endpoints?.issuer !== undefined && endpoints.issuer !== entry.issuer) {
        // Said out loud: a connection pointing somewhere other than the
        // vendor is not what the developer will want in the end, and nothing
        // else in the output would show it.
        reportWarning(`${entry.displayName} points at ${endpoints.issuer}, not the provider`);
      }
      const target = join(cwd, plan.path);
      await mkdir(dirname(target), { recursive: true });
      // `wx` rather than a plain write: planConnection decided this file does
      // not exist, and anything that appeared since is not ours to overwrite.
      await writeFile(target, `${stableStringify(connection)}\n`, { flag: "wx" });
      // The id first: it is the half the developer can read back afterwards,
      // and a connection missing either credential fails the same way.
      clientIdState = await publishClientId({
        name: scaffolded.clientId,
        value: clientId,
        publish,
      });
      secret = await storeClientSecret({
        name: scaffolded.clientSecret,
        value: secretValue,
        publish,
      });
      consola.success(`Wrote ${plan.path}`);
    }

    const written = await this.enableInConfiguration(cwd, schema, edits);

    for (const file of written) {
      consola.success(`Updated ${file}`);
    }
    for (const skipped of edits.skipped) {
      reportWarning(
        `Left ${skipped.region} alone: it has been edited by hand. Update it yourself.`,
      );
    }
    if (written.length === 0 && edits.skipped.length === 0) {
      consola.info(`${schema.name} and its login flow already offer ${entry.displayName}`);
    }
    if (clientIdState !== undefined && idVariable !== undefined) {
      reportClientIdOutcome(idVariable, clientIdState, this.meta.cliVersion);
    }
    if (secret) {
      // A reuse that piped nothing in had no value to publish; a create always
      // has one, because the command refuses without it.
      reportSecretOutcome(secret, this.meta.cliVersion, reusing);
    }
    this.reportOutcome(outcome);
    // `variables set` only for a credential that did not reach the project:
    // the connection references it as `${{ NAME }}` and the engine resolves
    // that from the project's variables, so a button whose credential never
    // arrived fails at token exchange. Then plan and apply, when a file
    // changed. All carry --cwd when the run did.
    const recovery = [
      { name: idVariable, secret: false, published: clientIdState },
      { name: variable, secret: true, published: secret?.published },
    ].flatMap(({ name, secret: isSecret, published }) =>
      name !== undefined && published !== undefined && published !== "stored"
        ? [
            [
              "variables",
              "set",
              name,
              "--project-level",
              ...(isSecret ? ["--secret"] : []),
              ...cwdArgs,
            ],
          ]
        : [],
    );
    const filesChanged = !reusing || written.length > 0;
    const followUps = [
      ...recovery,
      ...(filesChanged
        ? [
            ["plan", ...cwdArgs],
            ["apply", ...cwdArgs],
          ]
        : []),
    ];

    return this.emit({
      status: "ok",
      data: {
        ...this.payload({
          projectId: secretFile.project_id,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret,
          clientId: clientIdState,
          idVariable,
          changed: written,
          skipped: edits.skipped,
        }),
        // An ok result carries its follow-ups in data.next_commands (errors
        // use the top-level nextCommands instead), as strings only when every
        // argument is safe to run as written, and always as argument lists.
        next_commands: portableCommands(followUps, this.meta.cliVersion),
        next_args: followUps,
      },
      pretty: `Enabled ${entry.displayName} for ${schema.name}`,
    });
  }

  /**
   * How the connection's credentials reach the project, or `undefined` when there is
   * no project behind this run: `--source mock` answers from fixtures and has
   * no variables to write. The connection is built here rather than taken from
   * `OwnerCommand.connect` because this command addresses the local Project it
   * was pointed at, not an owner the developer named.
   */
  private publisher(secret: ZitadelSecret): SecretPublisher | undefined {
    const { source } = this.meta;
    if (source === "mock") {
      return undefined;
    }
    const client = createZitadelClient({ baseUrl: source, token: secret.project_secret });
    return async (name, value, { secret: isSecret }) => {
      await client.updateVariables(
        { [name]: { value, secret: isSecret } },
        { project_id: secret.project_id },
      );
    };
  }

  /**
   * The flows this provider must be added to, or a refusal.
   *
   * Called before the connection is written and before either credential is
   * published, because no flow means no button however well everything else
   * went: `plan` and `apply` both succeed and the sign-in screen simply never
   * offers the provider. Failing afterwards would leave a connection file and
   * two published variables behind for a provider that cannot be shown.
   */
  private async targetFlows(cwd: string, schema: SchemaFile): Promise<FlowFile[]> {
    const flows = await flowsForSchema(cwd, schema);
    if (flows.length === 0) {
      throw new ZitadelError("E_NOT_FOUND", `No login flow runs against ${schema.name}`, {
        hint:
          "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
          "names this schema. Check the flow's user_schema, or run `zitadel apply` first so the " +
          "schema's published id is recorded in .zitadel/state.json.",
        details: { schema: schema.path },
      });
    }
    // The editors read a region they cannot recognise as absent and write the
    // generated one over it. Refuse here, before anything is written or
    // published, rather than discard whatever a developer put there.
    refuseUneditable(schema.path, schema.body, "schema");
    for (const flow of flows) {
      refuseUneditable(flow.path, flow.body, "flow");
    }
    return flows;
  }

  /** Write the edits `planEdits` worked out, and say which files changed. */
  private async enableInConfiguration(
    cwd: string,
    schema: SchemaFile,
    edits: PlannedEdits,
  ): Promise<string[]> {
    const written: string[] = [];
    if (edits.schema.changed) {
      await writeFile(join(cwd, schema.path), `${stableStringify(edits.schema.document)}\n`);
      written.push(schema.path);
    }
    for (const { flow, result } of edits.flows) {
      if (result.changed) {
        await writeFile(join(cwd, flow.path), `${stableStringify(result.document)}\n`);
        written.push(flow.path);
      }
    }
    return written;
  }

  /** The machine-readable payload. Never the secret, only whether it is held. */
  private payload(input: {
    /**
     * The Project the run addresses. `--json` suppresses the console line that
     * otherwise carries it, and a result that names only the schema does not
     * say which Project was changed.
     */
    projectId: string;
    provider: string;
    schema: string;
    plan: { action: string; slug: string; path?: string; file?: { path: string } };
    callbackUri: string;
    secret: SecretOutcome | undefined;
    clientId: PublishState | undefined;
    /**
     * The variable the connection names, which need not be the slug's, and is
     * `undefined` when the connection holds its client id as a literal.
     */
    idVariable: string | undefined;
    changed?: string[];
    skipped?: SsoSkipped[];
  }): Record<string, unknown> {
    return {
      project_id: input.projectId,
      provider: input.provider,
      schema: input.schema,
      connection: {
        action: input.plan.action,
        slug: input.plan.slug,
        file: input.plan.file?.path ?? input.plan.path ?? `${IDPS_DIR}/${input.plan.slug}.json`,
      },
      callback_uri: input.callbackUri,
      changed: input.changed ?? [],
      untouched: (input.skipped ?? []).map((s) => s.region),
      client_id:
        input.clientId === undefined || input.idVariable === undefined
          ? null
          : { variable: input.idVariable, published: input.clientId },
      secret:
        input.secret === undefined
          ? null
          : { variable: input.secret.name, published: input.secret.published },
    };
  }

  private async askClientId(displayName: string, nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      throw new ZitadelError("E_VALIDATION", `No client id supplied for ${displayName}.`, {
        hint: "Pass --client-id, or run without --non-interactive to be asked for it.",
      });
    }
    const answer = await text({
      message: "Client ID",
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => ((value ?? "").trim() === "" ? "Enter the client id." : undefined),
    });
    bailOnCancel(answer, "Enable");
    return String(answer).trim();
  }

  /**
   * A secret piped in on a scripted rerun, or `undefined` when nothing was.
   *
   * Reuse never demands one: the project may already hold it, and refusing an
   * unattended rerun for a credential that has not changed would be noise. It
   * is only read so that a rerun *can* replace it. A terminal on stdin means
   * nothing was piped, and reading would block forever on a stream with no
   * data and no end, so that case is answered rather than waited on.
   */
  private async pipedSecret(): Promise<string | undefined> {
    if (process.stdin.isTTY) {
      return undefined;
    }
    const piped = (await readStdin(process.stdin)).trim();
    return piped === "" ? undefined : piped;
  }

  /**
   * Required, like the client id. The connection document references the
   * secret as `${{ NAME }}` and the engine resolves that from the project's
   * variables, so enabling a provider without one writes a sign-in button
   * that fails at the token endpoint with `invalid_client` — a failure that
   * surfaces in a browser, not here. Refusing now is the cheaper answer.
   */
  private async askClientSecret(variable: string, nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      const refuse = (): never => {
        throw new ZitadelError("E_VALIDATION", `No client secret supplied for ${variable}.`, {
          hint: "Pipe it in on stdin, or run without --non-interactive to be asked for it. It is never a flag: that would put it in shell history, a process listing and CI logs.",
        });
      };
      if (process.stdin.isTTY) {
        refuse();
      }
      const piped = (await readStdin(process.stdin)).trim();
      return piped === "" ? refuse() : piped;
    }
    const answer = await password({
      message: `Client secret (published to the project as ${variable})`,
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => ((value ?? "").trim() === "" ? "Enter the client secret." : undefined),
    });
    bailOnCancel(answer, "Enable");
    return String(answer).trim();
  }
}

/** Stop on a document whose region the SSO editors would overwrite. */
function refuseUneditable(path: string, body: object, target: SsoEditTarget): void {
  const refusal = ssoEditRefusal(body, target);
  if (refusal === undefined) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${path}: ${refusal}`, {
    hint:
      "Enabling a provider edits this file, and that region is not the shape it edits. " +
      "Fix it against the dialect in .zitadel/meta/, then run the command again.",
    details: { file: path, region: refusal },
  });
}

/** The schema and flow edits a run will make, worked out before anything is written. */
type PlannedEdits = {
  readonly schema: SsoResult<object>;
  readonly flows: ReadonlyArray<{ flow: FlowFile; result: SsoResult<object> }>;
  /** Hand-edited regions the flow editors leave alone, named by file. */
  readonly skipped: SsoSkipped[];
};

/**
 * Enable the provider in the schema and every login flow that runs against
 * it, without writing anything. A flow belonging to another schema is left
 * alone: enabling Google for customers must not touch the employee journey.
 * The editors are pure and throw their refusals, so calling this before any
 * write or publish is what makes those refusals leave nothing behind.
 */
function planEdits(schema: SchemaFile, slug: string, flows: readonly FlowFile[]): PlannedEdits {
  const methods = enabledMethods(schema);
  const results = flows.map((flow) => ({ flow, result: applySsoToFlow(flow.body, slug, methods) }));
  return {
    schema: applySsoToSchema(schema.body, slug),
    flows: results,
    skipped: results.flatMap(({ flow, result }) =>
      result.skipped.map((entry) => ({ ...entry, region: `${flow.path} ${entry.region}` })),
    ),
  };
}
