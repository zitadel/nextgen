import { Args, Flags } from "@oclif/core";
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { GetVariables200 } from "@zitadel/api/generated/model";

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
  variableScope,
} from "../../lib/variables";
import { inShell } from "../../lib/suggestion";
import { reportWarning } from "../../lib/warnings";

/**
 * `zitadel variable set NAME [VALUE]` — enter or replace one variable on the
 * project.
 *
 * A plain value may be given on the command line; a secret never can. A secret
 * is prompted for, or read from stdin when scripting, so a credential cannot
 * land in shell history, a process listing, or CI logs. `--secret` stores it
 * encrypted under the project's own key, after which it can be replaced but
 * never read back (ADR 062 §7). `--preview` writes the override a preview
 * deploy prefers instead of the value every deploy freezes.
 */
export default class VariableSet extends EnvironmentCommand {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;
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
      description: "Write the preview override instead of the value every deploy freezes.",
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

    if (dryRun) {
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: it may be a credential.
      const preview = dryRunResult("set", "variable", name);
      return this.emit({
        ...preview,
        data: {
          ...(preview.data as object),
          secret: flags.secret,
          as: type,
          applies_to: flags.preview ? "preview" : "all",
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
      message: `Value for ${name}`,
      ...(flags.secret || args.value === undefined ? {} : { given: args.value }),
      stdin: true,
      // The selector this.suggest appends must precede the stdin redirection.
      retry: inShell(this.suggest(pipeArgs(name, flags.secret, type, flags.preview)), {
        after: " < value.txt",
      }),
      parse: (raw: string) => parseVariableValue(raw, type),
    });

    // The write answers with the slot it wrote, read back, so the output is the
    // store's own answer for that slot — a secret says only that a value is held
    // (ADR 062 §7), never the value itself.
    const written = slotState(
      name,
      (await client.updateVariables(
        { [name]: { value, secret: flags.secret } },
        scope,
      )) as GetVariables200,
    );
    this.recordTelemetry({ is_secret: flags.secret });

    // A write to one slot leaves the other standing, so that one is read too.
    // It is only reported: a token that may write but not read variables has
    // still stored the value, and must not be told the write failed.
    const otherSlot = await readSlot(() =>
      client.getVariables({
        project_id: projectId,
        ...(flags.preview ? {} : { applies_to: "preview" as const }),
      }),
    );
    const other = otherSlot === undefined ? undefined : slotState(name, otherSlot);
    const all = flags.preview ? other : written;
    const preview = flags.preview ? written : other;

    return this.emit({
      status: "ok",
      data: {
        name,
        type,
        applies_to: flags.preview ? "preview" : "all",
        ...(all === undefined ? {} : { all }),
        ...(preview === undefined ? {} : { preview }),
      },
      pretty: renderDetail(`Set ${name} on the project`, ["all", "preview"], {
        all: all === undefined ? "(not readable)" : slotCell(all),
        preview: preview === undefined ? "(not readable)" : slotCell(preview),
      }),
    });
  }
}

/**
 * What the store holds for one name in one slot, as a read reports it. A name
 * the slot does not hold is `held: false` rather than omitted, so the output
 * tells an empty value apart from a withdrawn one. A secret is `held` without a
 * value: the platform never discloses one.
 */
type SlotState =
  | { held: false }
  | { held: true; secret: true }
  | { held: true; secret: false; value: string | number | boolean };

function slotState(name: string, bucket: GetVariables200): SlotState {
  // A held name always carries a value — a scalar, or `{secret:true}` for a
  // secret — so `undefined` is exactly the slot not holding the name.
  const held = bucket[name];
  if (held === undefined) {
    return { held: false };
  }
  const row = toVariableRow(name, held);
  return row.secret
    ? { held: true, secret: true }
    : { held: true, secret: false, value: row.value as string | number | boolean };
}

/**
 * One slot rendered for a terminal. A held value goes through the same escaping
 * the tables use — a stored value is attacker-influenceable — and a secret
 * prints its marker rather than a value. A slot the name does not hold reads as
 * `(not set)` so it is not mistaken for an empty value.
 */
function slotCell(slot: SlotState): string {
  if (!slot.held) {
    return "(not set)";
  }
  const row: VariableRow = slot.secret
    ? { name: "", secret: true }
    : { name: "", secret: false, value: slot.value };
  const [cell] = variableCells([row]);
  return cell === undefined || cell.value === "" ? '""' : cell.value;
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the secret flag, the type and the preview flag the run actually
 * used. Dropping any of them would hand back a command that writes a credential
 * as a readable value, stores a number as a string, or writes the wrong value.
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
 * A bucket read after the write has landed, or nothing when it cannot be read:
 * the value is already stored, so a refused or failed courtesy read is said
 * aloud rather than reported as a failed write.
 */
async function readSlot(
  read: () => Promise<GetVariables200>,
): Promise<GetVariables200 | undefined> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
      reportWarning(
        `The value was stored, but the other slot could not be read back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }
}
