import { Args, Flags } from "@oclif/core";
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../../../lib/api-client";
import { ZitadelError } from "../../../lib/errors";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../../lib/oclif";
import { variableNameArg } from "../name";
import { dryRunResult } from "../../../lib/oclif/crud/shared";
import {
  parseVariableValue,
  toVariableRow,
  VARIABLE_TYPES,
  variableCells,
  type VariableRow,
  type VariableType,
  type VariableValue,
  type VariableKind,
} from "../../../lib/variables";
import { VariableService } from "../../../lib/backend";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { inShell, type SuggestedCommand } from "../../../lib/suggestion";
import { Promptable } from "../../../lib/oclif/promptable";
import { Tabulatable } from "../../../lib/oclif/tabulatable";

/** How a secret asked to be stored as another type is refused. */
const SECRET_AS_STRING_REFUSAL: Refusal = {
  message: "A secret is stored as a string.",
  hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
};

/** How a secret given on the command line, where it would reach shell history, is refused. */
const SECRET_VALUE_REFUSAL: Refusal = {
  message: "A secret value is not given on the command line.",
  hint: "Drop the value and pipe it in, or let the prompt ask for it.",
};

/** How a value that does not parse as the type `--as` names is refused. */
const VALUE_TYPE_REFUSAL: Refusal = {
  message: '"{value}" is not a valid {as} value.',
  hint: "A boolean variable is exactly `true` or `false`, and a number is a JSON number such as 5, -1.5 or 1e3. Pass --as string to keep it as text.",
};

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
export default class VariableSet extends Tabulatable(Promptable(EnvironmentCommand)) {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable set GOOGLE_CLIENT_ID 1234.apps.googleusercontent.com",
    "<%= config.bin %> variable set GOOGLE_CLIENT_SECRET --secret < secret.txt",
    "<%= config.bin %> variable set SESSION_TTL 3600 --as number",
    "<%= config.bin %> variable set API_URL https://preview.acme.com --preview",
  ];
  static override args = {
    name: variableNameArg({
      required: true,
      description: "Variable name (letters, digits and underscores).",
    }),
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
    as: Flags.option({
      options: VARIABLE_TYPES,
      default: "string",
      description: "Store the value as this JSON type.",
    })(),
    preview: Flags.boolean({
      default: false,
      description: "Write the preview value alone, leaving the primary one as it is.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableSet>): Promise<JsonEnvelope> {
    if (flags.secret && flags.as !== "string") {
      throw refusalError(SECRET_AS_STRING_REFUSAL, {});
    }
    if (flags.secret && args.value !== undefined) {
      throw refusalError(SECRET_VALUE_REFUSAL, {});
    }
    if (args.value !== undefined && !parseVariableValue(args.value, flags.as).ok) {
      throw refusalError(VALUE_TYPE_REFUSAL, {
        value: args.value,
        as: flags.as,
      });
    }

    const { client, projectId } = await this.connect();
    const variableService = new VariableService(client, projectId);
    if (flags.preview && !flags.secret) {
      await refusePreviewOfSecret(client, projectId, args.name, (command) => {
        return this.suggest(command);
      });
    }
    // The kinds this write sets, as the platform's rule gives them: the preview
    // kind alone under `--preview`, otherwise both for a plain value and the
    // primary kind for a secret.
    const kinds = flags.preview ? ["preview"] : flags.secret ? ["primary"] : ["primary", "preview"];

    if (this.dryRun) {
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: it may be a credential.
      const preview = dryRunResult("set", "variable", args.name);
      return this.emit({
        ...preview,
        data: {
          ...(preview.data as object),
          name: args.name,
          type: flags.as,
          secret: flags.secret,
          kinds,
        },
        pretty: `${preview.pretty} on the project${flags.secret ? " (secret)" : ""}${flags.as === "string" ? "" : ` as ${flags.as}`}${flags.preview ? " (preview)" : ""}`,
      });
    }

    // A plain value given on the command line is used as it is. Otherwise the
    // value is prompted for, or piped in when scripting. The prompt is masked
    // when the value is to be stored as a secret, so it does not stay on screen
    // or in a scrollback buffer. An empty string is a value the scalar schema
    // accepts; only an absent input is an error.
    const value = await this.input({
      kind: flags.secret ? "secret" : "text",
      name: `value for ${args.name}`,
      message: `What should the value of ${args.name} be?`,
      ...(flags.secret || args.value === undefined ? {} : { given: args.value }),
      stdin: true,
      // The selector this.suggest appends must precede the stdin redirection.
      retry: inShell(this.suggest(pipeArgs(args.name, flags.secret, flags.as, flags.preview)), {
        after: " < value.txt",
      }),
      parse: (raw: string) => parseVariableValue(raw, flags.as),
    });

    // The write answers with the kind it wrote, so a secret says only that a
    // value is held (ADR 062 §7), never the value itself. The kind this write
    // did not touch is read in a separate call: the platform never merges the
    // two kinds in one answer.
    const written = await variableService.set(
      args.name,
      { value, secret: flags.secret },
      flags.preview ? "preview" : undefined,
    );
    this.recordTelemetry({ is_secret: flags.secret });
    const stateOfKind = async (kind: VariableKind): Promise<KindState> =>
      stateOf(
        written?.[kind] !== undefined
          ? written[kind]
          : (await variableService.ofKind(kind))[args.name]?.[kind],
      );
    const primary = await stateOfKind("primary");
    const previewState = await stateOfKind("preview");

    return this.emit({
      status: "ok",
      data: { name: args.name, type: flags.as, kinds, primary, preview: previewState },
      pretty: this.tabulateDetail(`Set ${args.name} on the project`, ["primary", "preview"], {
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

/**
 * Refuses a plain preview value for a name whose primary value is a secret: it
 * holds a credential, so its preview value is one too, and stored plain it
 * would be readable and a preview deploy would freeze it in the clear. A token
 * that may not read the primary values leaves the check to whoever can; any
 * other failure leaves the classification unknown, and writing on an unknown is
 * the one outcome this guard exists to prevent.
 *
 * The suggestion is built by the caller, because it must carry the run's
 * selector before the stdin redirection.
 */
export async function refusePreviewOfSecret(
  client: ZitadelClient,
  projectId: string,
  name: string,
  suggest: (command: string) => SuggestedCommand,
): Promise<void> {
  const variableService = new VariableService(client, projectId);
  const held = await variableService
    .ofKind("primary")
    .then((body) => {
      return body[name]?.primary;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) {
        return undefined;
      }
      throw error;
    });
  if (typeof held !== "object" || held === null) {
    return;
  }
  throw new ZitadelError(
    "E_VALIDATION",
    `${name} is a secret, so its preview value must be one too.`,
    {
      hint: "Set the preview value with --secret, piped in or prompted for.",
      nextCommands: [
        inShell(suggest(`variable set ${name} --secret --preview`), {
          after: " < value.txt",
        }),
      ],
    },
  );
}
