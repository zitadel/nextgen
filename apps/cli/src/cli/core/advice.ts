import type { ConsentRequiredError } from "@/lib/consent";
import type {
  EnvironmentInvalidError,
  EnvironmentInvalidReason,
  EnvironmentValueMissingError,
} from "@/lib/environment";
import {
  confirmationHint,
  isLibError,
  type LibError,
  toZitadelError,
  ZitadelError,
} from "@/lib/errors";
import type { IdpSettingInvalidError, IdpSettingReason } from "@/lib/idp";
import type {
  OrcaFrameworkError,
  OrcaPatchFileConflictError,
  OrcaPatchForce,
  OrcaRendererError,
  OrcaScaffoldBlockedError,
} from "@/lib/orca";
import type { ProjectFileMalformedError, ProjectFileMissingError } from "@/lib/project";
import type { PublishConfigInvalidError, PublishConnectionError } from "@/lib/publish";
import type { Suggested } from "@/lib/suggestion";
import type { ZitadelConfigEditBreaksFlowsError } from "@/lib/zitadel";

/** What the CLI adds to a library failure: its flags and commands, which the library leaves out. */
type Advice = {
  /** The hint, in place of the failure's own. */
  readonly hint?: string | undefined;
  /** Words added after the failure's own hint. */
  readonly after?: string | undefined;
  /** The commands to run next. */
  readonly nextCommands?: readonly Suggested[] | undefined;
  /** The facts to report in place of the error's own. */
  readonly details?: unknown;
};

/** Words the advice for one class of failure. */
type Adviser = (error: Error & LibError) => Advice;

/**
 * An {@link Adviser} for one class, which its table key guarantees it is given.
 *
 * @param advise - Words the advice for the class.
 * @returns The adviser the table holds.
 */
function adviser<T extends Error & LibError>(advise: (error: T) => Advice): Adviser {
  return (error) => {
    return advise(error as T);
  };
}

/** What closes every refusal of a patch's preflight. */
const PREFLIGHT_FORCE_NOTE =
  "--force can't fix this: it only replaces files at the paths setup writes.";

/** What closes a patch's conflict with a file, by what would resolve it. */
const PATCH_FORCE_ADVICE: Record<OrcaPatchForce, string | undefined> = {
  replaces: "Rerun with --force if you want the CLI to replace this file.",
  useless: PREFLIGHT_FORCE_NOTE,
  none: undefined,
};

/** What to do about a failure to publish a connection, by the field it was for. */
function connectionAdvice(error: PublishConnectionError): Advice {
  const wantsSecret = error.field === "client_secret";
  const setCommand: Suggested = {
    id: "variable:set",
    args: { name: error.variable },
    flags: { secret: wantsSecret, preview: error.mode === "preview" },
  };

  return {
    hint: wantsSecret
      ? "The client secret must be a secret variable: publish it with the command below."
      : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
    nextCommands: [setCommand],
  };
}

/** What to do about a refused provider or setting, by why it was refused. */
const IDP_SETTING_ADVICE: Record<IdpSettingReason, (error: IdpSettingInvalidError) => string> = {
  invalid: (error) => {
    return `Fix ${error.facts.field} and run the command again.`;
  },
  conflicting: (error) => {
    const count = error.facts.given?.length ?? 0;

    return `Add ${error.facts.providerField} custom, or remove ${new Intl.PluralRules("en").select(count) === "one" ? "it" : "them"}.`;
  },
  missing: (error) => {
    return `Describe the connection, e.g. ${error.facts.example}`;
  },
};

/** What to do about a refused environment, by why it was refused. */
const ENVIRONMENT_INVALID_ADVICE: Record<
  EnvironmentInvalidReason,
  (error: EnvironmentInvalidError) => string
> = {
  "both-sources": () => {
    return "--env picks the .env.<name>.local files; --env-file names one file outright.";
  },
  name: (error) => {
    return (
      `The ${error.source} environment name may use only letters, digits, dot, dash ` +
      'and underscore, may not contain "..", and may not be `local` or end in `.local`. ' +
      "Pass a safe --env or set ZITADEL_ENV."
    );
  },
  "server-url": (error) => {
    return `Fix or remove ZITADEL_URL in ${error.source}; it must be a URL such as ${error.example}.`;
  },
};

/** The advice for the secret project file a command can restore. */
const RESTORE_SECRET: Advice = {
  hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
  nextCommands: [{ id: "doctor", flags: { fix: true } }],
};

/**
 * What to do about a failure, by the class that raised it, and by `name:reason`
 * for one reason of a class: the CLI's words and commands. A class with no row
 * is reported with its own hint.
 */
const ADVICE: Readonly<Record<string, Adviser>> = {
  ConsentRequiredError: adviser<ConsentRequiredError>((error) => {
    return {
      hint: confirmationHint(error.question),
      nextCommands: error.retry === undefined ? undefined : [error.retry],
      details: error.details ?? { question: error.question },
    };
  }),
  ZitadelConfigEditBreaksFlowsError: adviser<ZitadelConfigEditBreaksFlowsError>((error) => {
    return {
      nextCommands: error.dryRun ? [{ id: "deploy", flags: { dryRun: true } }] : undefined,
    };
  }),
  "OrcaFrameworkError:none": () => {
    return {
      after:
        "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
    };
  },
  "OrcaFrameworkError:mismatch": adviser<OrcaFrameworkError>((error) => {
    const { requested, detected, requestedName } = error.details ?? {};

    return {
      after:
        `Rerun setup without --framework, or with --framework ${String(detected)}, to set up this ` +
        `app, or point --cwd at the ${String(requestedName ?? requested)} app you meant. Setup never ` +
        "scaffolds a new app over one it detects, --force or not.",
    };
  }),
  "OrcaScaffoldBlockedError:occupied": adviser<OrcaScaffoldBlockedError>(() => {
    return {
      after:
        "Pass --force to scaffold into a non-empty directory, or run setup from an existing " +
        "supported app project.",
    };
  }),
  OrcaPatchFileConflictError: adviser<OrcaPatchFileConflictError>((error) => {
    return { after: PATCH_FORCE_ADVICE[error.force] };
  }),
  "OrcaRendererError:pending": adviser<OrcaRendererError>(() => {
    return {
      after:
        "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
    };
  }),
  PublishConfigInvalidError: adviser<PublishConfigInvalidError>((error) => {
    const fix = error.literalSecret
      ? 'Publish a secret with the command below and reference it as "${{ NAME }}".'
      : "Fix the files named above and rerun; no changes were made.";

    return {
      hint: error.refusedKey
        ? `${fix} A key a newer Zitadel server added needs a CLI as new as the server.`
        : fix,
      nextCommands: error.literalSecret
        ? [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }]
        : undefined,
    };
  }),
  "PublishConnectionError:shared-variable": () => {
    return {
      hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
    };
  },
  "PublishConnectionError:wrong-kind": adviser<PublishConnectionError>(connectionAdvice),
  "PublishConnectionError:missing-variable": adviser<PublishConnectionError>((error) => {
    return {
      hint: "Publish it with the command below, then deploy again.",
      nextCommands: connectionAdvice(error).nextCommands,
    };
  }),
  EnvironmentInvalidError: adviser<EnvironmentInvalidError>((error) => {
    return { hint: ENVIRONMENT_INVALID_ADVICE[error.reason](error) };
  }),
  EnvironmentValueMissingError: adviser<EnvironmentValueMissingError>((error) => {
    const { key, file, boundFile, unbound, environment } = error;
    const consulted = `Consulted, in order: ${error.consulted.join(", ")}.`;

    if (!unbound) {
      return {
        hint: `${consulted} Set ${key} in ${file ?? `${boundFile} or the process environment`}${file === undefined ? "" : " or the process environment"}.`,
      };
    }

    // Run in the directory this run addressed, which need not be the shell's:
    // `setup` and `env add` both write their files there.
    const elsewhere = error.cwd === process.cwd() ? {} : { cwd: error.cwd };

    return {
      hint: `${consulted} Set ${key} in ${boundFile} or the process environment, or run \`zitadel env add ${environment}\`.`,
      nextCommands: [
        environment === "development"
          ? { id: "setup", flags: elsewhere }
          : { id: "env:add", args: { name: environment }, flags: elsewhere },
      ],
    };
  }),
  "BackendUnavailableError:unreachable": () => {
    return { hint: "Check your connection and the server URL (ZITADEL_URL or --server)." };
  },
  ProjectFileMissingError: adviser<ProjectFileMissingError>((error) => {
    return error.file === "secret"
      ? RESTORE_SECRET
      : { hint: "Set the project up first.", nextCommands: [{ id: "setup" }] };
  }),
  ProjectFileMalformedError: adviser<ProjectFileMalformedError>((error) => {
    return error.file === "secret"
      ? RESTORE_SECRET
      : { hint: "Fix zitadel.json, which is the project's committed configuration." };
  }),
  IdpSettingInvalidError: adviser<IdpSettingInvalidError>((error) => {
    return { hint: IDP_SETTING_ADVICE[error.reason](error) };
  }),
};

/**
 * A failure as the CLI reports it: its own words and commands added, then the
 * boundary's error.
 *
 * @param error - Whatever was thrown.
 * @returns The CLI's error.
 */
export function reported(error: unknown): ZitadelError {
  return toZitadelError(advised(error));
}

/**
 * A library failure with the CLI's own words and commands added.
 *
 * @param error - Whatever was thrown.
 * @returns The CLI's error when the failure has advice, else `error` as it was.
 */
export function advised(error: unknown): unknown {
  if (!isLibError(error)) {
    return error;
  }
  const reason = "reason" in error && typeof error.reason === "string" ? error.reason : undefined;
  const advise =
    (reason === undefined ? undefined : ADVICE[`${error.name}:${reason}`]) ?? ADVICE[error.name];
  if (advise === undefined) {
    return error;
  }
  const advice = advise(error);
  const hint =
    advice.hint ??
    [error.hint, advice.after]
      .filter((part) => {
        return part !== undefined;
      })
      .join(" ");
  const details = advice.details ?? error.details;

  return new ZitadelError(error.code, error.message, {
    cause: error,
    ...(hint === "" || hint === undefined ? {} : { hint }),
    ...(advice.nextCommands === undefined ? {} : { nextCommands: advice.nextCommands }),
    ...(details === undefined ? {} : { details }),
  });
}
