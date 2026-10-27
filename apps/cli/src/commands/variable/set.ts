import { Args, Flags } from "@oclif/core";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { renderDetail } from "../../lib/oclif/crud/table";
import { ZitadelError } from "../../lib/errors";
import {
  assertVariableName,
  parseVariableValue,
  toVariableRow,
  VARIABLE_TYPES,
  variableCells,
  type VariableRow,
  type VariableType,
  type VariableValue,
  type VariableKind,
  variableReadScope,
  variableScope,
} from "../../lib/variables";
import { inShell } from "../../lib/suggestion";
import { Promptable } from "../../lib/oclif/promptable";

/**
 * `zitadel variable set NAME [VALUE]` — enter or replace one variable on the
 * project.
 *
 * A plain value may be given on the command line; a secret never can. A secret
 * is prompted for, or read from stdin when scripting, so a credential cannot
 * land in shell history, a process listing, or CI logs. `--secret` stores it
 * encrypted under the project's own key, after which it can be replaced but
 * never read back (ADR 062 §7).
 *
 * Without `--preview` the platform's default applies: a plain value is stored
 * for both kinds, so primary and preview deploys both see it, and a secret for
 * the primary kind only, removing any preview value so a preview never keeps a
 * plaintext copy. `--preview` writes the preview kind alone.
 */
export default class VariableSet extends Promptable(EnvironmentCommand) {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;

  static override heading = "Setting a variable";
  static override examples = [
    "<%= config.bin %> variable set GOOGLE_CLIENT_ID 1234.apps.googleusercontent.com",
    "<%= config.bin %> variable set GOOGLE_CLIENT_SECRET --secret < secret.txt",
    "<%= config.bin %> variable set SESSION_TTL 3600 --as number",
    "<%= config.bin %> variable set API_URL https://preview.acme.com --preview",
  ];
  static override args = {
    name: nonBlankArg({
      required: true,
      description: "Variable name (letters, digits and underscores).",
    }),
    // A plain value may be given here; an empty string is a value the scalar
    // schema accepts, so this is not `nonBlankArg`. A secret refuses it below.
    // `ignoreStdin` keeps oclif from folding piped input into this arg — a
    // secret and a scripted plain value both arrive on stdin, which this command
    // reads itself through `input`.
    value: Args.string({
      required: false,
      ignoreStdin: true,
      description: "The value, for a plain (non-secret) variable.",
    }),
  };
  static override flags = {
    secret: Flags.boolean({
      default: false,
      description: "Store the value encrypted. It can be replaced later but never read back.",
    }),
    as: Flags.string({
      options: [...VARIABLE_TYPES],
      default: "string",
      description: "Store the value as this JSON type.",
    }),
    preview: Flags.boolean({
      default: false,
      description: "Write the preview value alone, leaving the primary one as it is.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableSet);
    await this.toMeta(flags);
    const { dryRun } = this.meta;
    const name = args.name;
    const type = flags.as as VariableType;

    assertVariableName(name);
    // A credential is a string: a numeric-looking key stored as a number could
    // lose digits, and one stored as a boolean is meaningless. Refused before
    // anything is asked for, so no secret is typed only to be turned away.
    if (flags.secret && type !== "string") {
      throw new ZitadelError("E_VALIDATION", "A secret is stored as a string.", {
        hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
      });
    }
    // A secret never comes from the command line: it would land in shell history
    // and a process listing. It is prompted for or piped instead.
    if (flags.secret && args.value !== undefined) {
      throw new ZitadelError("E_VALIDATION", "A secret value is not given on the command line.", {
        hint: "Drop the value and pipe it in, or let the prompt ask for it.",
      });
    }

    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);
    // The kinds this write sets, as the platform's rule gives them: the preview
    // kind alone under `--preview`, otherwise both for a plain value and the
    // primary kind for a secret.
    const kinds = flags.preview ? ["preview"] : flags.secret ? ["primary"] : ["primary", "preview"];

    // A name whose primary value is a secret holds a credential, so its preview
    // value is one too: stored plain it would be readable, and a preview deploy
    // would freeze the credential in the clear. A token that may not read the
    // primary values leaves the check to whoever can.
    if (flags.preview && !flags.secret) {
      // Only a refusal is tolerated, and only because the check then belongs to
      // whoever can read the primary values. Any other failure leaves the
      // classification unknown, and writing on an unknown would be the one
      // outcome this guard exists to prevent: a credential stored in the clear.
      const held = await client
        .getVariables({ project_id: projectId, kind: "primary" })
        .then((body) => body[name]?.primary)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 403) {
            return undefined;
          }
          throw error;
        });
      if (typeof held === "object" && held !== null) {
        throw new ZitadelError(
          "E_VALIDATION",
          `${name} is a secret, so its preview value must be one too.`,
          {
            hint: "Set the preview value with --secret, piped in or prompted for.",
            nextCommands: [
              inShell(this.suggest(pipeArgs(name, true, "string", true)), {
                after: " < value.txt",
              }),
            ],
          },
        );
      }
    }

    if (dryRun) {
      // A value given on the command line is checked as the real run checks
      // it, so a preview never reports a write the run would refuse.
      const given = args.value === undefined ? undefined : parseVariableValue(args.value, type);
      if (given !== undefined && !given.ok) {
        throw new ZitadelError("E_VALIDATION", given.problem);
      }
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: it may be a credential.
      const preview = dryRunResult("set", "variable", name);
      return this.emit({
        ...preview,
        data: {
          ...(preview.data as object),
          name,
          type,
          secret: flags.secret,
          kinds,
        },
        pretty: `${preview.pretty} on the project${flags.secret ? " (secret)" : ""}${type === "string" ? "" : ` as ${type}`}${flags.preview ? " (preview)" : ""}`,
      });
    }

    // A plain value given on the command line is used as it is. Otherwise the
    // value is prompted for, or piped in when scripting. The prompt is masked
    // when the value is to be stored as a secret, so it does not stay on screen
    // or in a scrollback buffer. An empty string is a value the scalar schema
    // accepts; only an absent input is an error.
    const value = await this.input({
      kind: flags.secret ? "secret" : "text",
      name: `value for ${name}`,
      message: `What should the value of ${name} be?`,
      ...(flags.secret || args.value === undefined ? {} : { given: args.value }),
      stdin: true,
      // The selector this.suggest appends must precede the stdin redirection.
      retry: inShell(this.suggest(pipeArgs(name, flags.secret, type, flags.preview)), {
        after: " < value.txt",
      }),
      parse: (raw: string) => parseVariableValue(raw, type),
    });

    // The write answers with the kind it wrote, so a secret says only that a
    // value is held (ADR 062 §7), never the value itself. The kind this write
    // did not touch is read in a separate call: the platform never merges the
    // two kinds in one answer.
    const written = (
      await client.updateVariables({ [name]: { value, secret: flags.secret } }, scope)
    )[name];
    this.recordTelemetry({ is_secret: flags.secret });
    const stateOfKind = async (kind: VariableKind): Promise<KindState> =>
      stateOf(
        written?.[kind] !== undefined
          ? written[kind]
          : (await client.getVariables(variableReadScope(projectId, kind === "preview")))[name]?.[
              kind
            ],
      );
    const primary = await stateOfKind("primary");
    const previewState = await stateOfKind("preview");

    return this.emit({
      status: "ok",
      data: { name, type, kinds, primary, preview: previewState },
      pretty: renderDetail(`Set ${name} on the project`, ["primary", "preview"], {
        primary: stateCell(primary),
        preview: stateCell(previewState),
      }),
    });
  }
}

/**
 * What the store holds for one name of one kind, as a read reports it. A kind
 * the name has no value for is `held: false` rather than omitted, so the output
 * tells an empty value apart from a withdrawn one. A secret is `held` without a
 * value: the platform never discloses one.
 */
type KindState =
  | { held: false }
  | { held: true; secret: true }
  | { held: true; secret: false; value: string | number | boolean };

function stateOf(value: VariableValue | undefined): KindState {
  // A held kind always carries a value — a scalar, or `{secret:true}` for a
  // secret — so `undefined` is exactly the name not holding that kind.
  if (value === undefined) {
    return { held: false };
  }
  const row = toVariableRow("", value);
  return row.secret
    ? { held: true, secret: true }
    : { held: true, secret: false, value: row.value as string | number | boolean };
}

/**
 * One kind rendered for a terminal. A held value goes through the same escaping
 * the tables use — a stored value is attacker-influenceable — and a secret
 * prints its marker rather than a value. A kind the name has no value for reads
 * as `(not set)` so it is not mistaken for an empty value.
 */
function stateCell(state: KindState): string {
  if (!state.held) {
    return "(not set)";
  }
  const row: VariableRow = state.secret
    ? { name: "", secret: true }
    : { name: "", secret: false, value: state.value };
  const [cell] = variableCells([row]);
  return cell === undefined || cell.value === "" ? '""' : cell.value;
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the secret flag, the type and the preview flag the run actually
 * used. Dropping any of them would hand back a command that writes a credential
 * as a readable value, stores a number as a string, or writes the wrong kind.
 */
function pipeArgs(name: string, secret: boolean, type: VariableType, preview: boolean): string {
  return [
    "variable",
    "set",
    name,
    ...(secret ? ["--secret"] : []),
    ...(type === "string" ? [] : ["--as", type]),
    ...(preview ? ["--preview"] : []),
  ].join(" ");
}
