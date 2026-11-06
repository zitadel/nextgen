import { Args, Flags } from "@oclif/core";
import { errorMessage, ZitadelError } from "@/lib/errors";

import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { type Variable, VariableService, VariableWrite } from "@/lib/backend";
import { variableNameArg } from "./name";
import { heldCell, parseVariableValue, VARIABLE_TYPES, type VariableType } from "@/lib/variables";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { reportWarning } from "@/lib/warnings";
import { DEPLOY_ARGS, inShell } from "@/lib/suggestion";
import { Promptable } from "@/lib/oclif/promptable";
import { Tabulatable } from "@/lib/oclif/tabulatable";
import { painted } from "@/lib/oclif/rendering";

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
    // The one place this run reads `--secret` and `--preview` as a decision:
    // the write carries both, and owns which kinds they set, from here on.
    const write = VariableWrite.of({
      secret: flags.secret,
      preview: flags.preview,
    });

    if (write.secret && flags.as !== "string") {
      throw refusalError(SECRET_AS_STRING_REFUSAL, {});
    }
    if (write.secret && args.value !== undefined) {
      throw refusalError(SECRET_VALUE_REFUSAL, {});
    }
    if (args.value !== undefined && !parseVariableValue(args.value, flags.as).ok) {
      throw refusalError(VALUE_TYPE_REFUSAL, {
        value: args.value,
        as: flags.as,
      });
    }

    if (this.dryRun) {
      // Before the connection, as the resource commands do it: what this says
      // is read off the flags alone, so asking for a credential to say it would
      // refuse a dry run that has everything it needs.
      //
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: it may be a credential.
      const preview = dryRunResult({
        verb: "set",
        topic: "variable",
        id: args.name,
        clause: [
          "on the project",
          ...(write.secret ? ["(secret)"] : []),
          ...(flags.as === "string" ? [] : [`as ${flags.as}`]),
          ...(write.preview ? ["(preview)"] : []),
        ].join(" "),
      });

      return this.emit({
        ...preview,
        data: {
          ...(preview.data as object),
          name: args.name,
          type: flags.as,
          secret: write.secret,
          kinds: write.kinds,
        },
      });
    }

    const { client, projectId } = await this.connect();
    const variableService = new VariableService(client, projectId);

    // A plain value given on the command line is used as it is. Otherwise the
    // value is prompted for, or piped in when scripting. The prompt is masked
    // when the value is to be stored as a secret, so it does not stay on screen
    // or in a scrollback buffer. An empty string is a value the scalar schema
    // accepts; only an absent input is an error.
    const value = await this.input({
      kind: write.secret ? "secret" : "text",
      name: `value for ${args.name}`,
      message: `What should the value of ${args.name} be?`,
      ...(write.secret || args.value === undefined
        ? {}
        : {
            given: args.value,
          }),
      stdin: true,
      // The selector this.suggest appends must precede the stdin redirection.
      retry: inShell(this.suggest(pipeArgs(args.name, write, flags.as)), {
        after: " < value.txt",
      }),
      parse: (raw: string) => {
        return parseVariableValue(raw, flags.as);
      },
    });

    const written = await variableService.set(args.name, value, write);
    this.recordTelemetry({
      is_secret: write.secret,
    });

    switch (written.outcome) {
      case "needs-secret-preview": {
        throw new ZitadelError(
          "E_VALIDATION",
          `${args.name} is a secret, so its preview value must be one too.`,
          {
            hint: "Set the preview value with --secret, piped in or prompted for.",
            nextCommands: [
              inShell(this.suggest(`variable set ${args.name} --secret --preview`), {
                after: " < value.txt",
              }),
            ],
          },
        );
      }
      case "set": {
        // A kind the write stored but nobody could read back afterwards is
        // reported as unknown, not as empty: the value is on the project either
        // way, and saying it holds nothing would be wrong.
        for (const unverified of written.unverified) {
          reportWarning(
            `${args.name} was set, but what it now holds in the ${unverified.kind} kind could not be read: ${errorMessage(unverified.cause)}`,
          );
        }
        const unread = new Set(
          written.unverified.map((unverified) => {
            return unverified.kind;
          }),
        );
        const primary = unread.has("primary") ? UNKNOWN_STATE : stateOf(written.state.primary);
        const preview = unread.has("preview") ? UNKNOWN_STATE : stateOf(written.state.preview);
        // `preview` skips every environment but these two, so it is not suggested in another.
        const previewable = ["preview", "development"].includes(this.environment.name.value);
        return this.emit({
          status: "ok",
          data: {
            name: args.name,
            type: flags.as,
            kinds: write.kinds,
            primary,
            preview,
          },
          pretty: painted(
            this.tabulateDetail(`Set ${args.name} on the project`, ["primary", "preview"], {
              primary: stateCell(primary),
              preview: stateCell(preview),
            }),
          ),
          next: write.preview
            ? {
                actions: [
                  "The new preview value applies to the next `preview`: a preview build keeps using the variables its last deploy froze.",
                  ...(previewable
                    ? []
                    : [
                        "Run it in the preview or development environment: `preview` skips any other.",
                      ]),
                ],
                commands: previewable
                  ? [this.suggest("preview --origin '<preview-url>' -m '<what changed>'")]
                  : [],
              }
            : {
                actions: [
                  "The new value applies after the next `deploy`: sign-ins keep using the variables the last deploy froze.",
                ],
                commands: [this.suggest(DEPLOY_ARGS)],
              },
        });
      }
    }
  }
}

/**
 * What the store holds for one name of one kind, as a read reports it. A kind
 * the name has no value for is `held: false` rather than omitted, so the output
 * tells an empty value apart from a withdrawn one. A secret is `held` without a
 * value: the platform never discloses one.
 */
type KindState =
  | {
      held: "unknown";
    }
  | {
      held: false;
    }
  | {
      held: true;
      secret: true;
    }
  | {
      held: true;
      secret: false;
      value: string | number | boolean;
    };

/** A kind the write stored but whose value afterwards nobody could read. */
const UNKNOWN_STATE: KindState = {
  held: "unknown",
};

function stateOf(variable: Variable | undefined): KindState {
  if (variable === undefined) {
    return {
      held: false,
    };
  }
  return variable.secret
    ? {
        held: true,
        secret: true,
      }
    : {
        held: true,
        secret: false,
        value: variable.value as string | number | boolean,
      };
}

/**
 * One kind rendered for a terminal: a secret prints its marker rather than a
 * value, and a kind the name has no value for reads as `(not set)` so it is not
 * mistaken for an empty value. The render boundary escapes what it prints.
 */
function stateCell(state: KindState): string {
  if (state.held === "unknown") {
    return "(unknown)";
  }
  if (!state.held) {
    return "(not set)";
  }
  return heldCell(
    state.secret
      ? {
          secret: true,
        }
      : {
          secret: false,
          value: state.value,
        },
  );
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the write the run actually made and the type it stored. Dropping
 * any of them would hand back a command that writes a credential as a readable
 * value, stores a number as a string, or writes the wrong kind.
 */
function pipeArgs(name: string, write: VariableWrite, type: VariableType): string {
  return [
    "variable",
    "set",
    name,
    ...(write.secret ? ["--secret"] : []),
    ...(type === "string" ? [] : ["--as", type]),
    ...(write.preview ? ["--preview"] : []),
  ].join(" ");
}
