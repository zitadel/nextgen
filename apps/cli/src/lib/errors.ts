import { stripVTControlCharacters as stripAnsi } from "node:util";

import { BackendError } from "./backend";
import type { ConsentRequiredError } from "./consent";
import type {
  EnvironmentInvalidReason,
  EnvironmentInvalidError,
  EnvironmentValueMissingError,
} from "./environment";
import type { IdpSettingInvalidError, IdpSettingReason } from "./idp";
import { isObject } from "./json";
import type { ProjectFileMalformedError, ProjectFileMissingError } from "./project";
import type { Suggested } from "./suggestion";
import type {
  OrcaFrameworkError,
  OrcaPatchFileConflictError,
  OrcaPatchForce,
  OrcaRendererError,
  OrcaScaffoldBlockedError,
} from "./orca";
import type { PublishConfigInvalidError, PublishConnectionError } from "./publish";
import type { ZitadelConfigEditBreaksFlowsError } from "./zitadel";

/**
 * The one sentence a cancellation ends on, wherever it is reported.
 *
 * One word, in the past tense and without a full stop, like every other
 * closing line. It says nothing about what was or was not changed, because
 * Ctrl-C can land after the work as easily as before it, and a sentence that
 * is sometimes a lie is worse than a short one that is always true. A command
 * that does know says so on a line under this one.
 */
export const CANCELLED = "Cancelled";

/**
 * The closed set of kinds a failure can be, shared by every package's errors.
 *
 * @remarks
 * A package's base error carries one of these as `category`, so the command
 * that catches it, and the boundary that finally reports it, can say what
 * kind of failure it was without knowing which package raised it.
 *
 * Choose one by walking this list in order; the first yes wins.
 *
 * 1. `fault`: our own code is wrong (an internal guard).
 * 2. `unknown`: nobody anticipated it, so there is no typed class. The
 *    boundary assigns it to any error that is not categorized; a typed class
 *    never uses it, except a package's own "<X>FailedError" generic wrapper.
 * 3. `unavailable`: the request got no decision: no network, a timeout, a 429,
 *    a 5xx, a server or machine that is not up, a port or lock that is held.
 * 4. `denied`: the problem is identity: not signed in, or not allowed (401, 403).
 * 5. `missing`: the thing it refers to is not there (404, 410).
 * 6. `conflict`: it exists but its state refuses: already exists, a stale
 *    write, a prerequisite not in place, a server not running.
 * 7. `invalid`: whatever remains: the input can never work as given,
 *    including an unsupported shape or version.
 *
 * Whether trying the identical request again may work is a separate trait,
 * {@link Categorized.retryable}.
 */
export const ERROR_CATEGORIES = [
  "invalid",
  "missing",
  "conflict",
  "denied",
  "unavailable",
  "fault",
  "unknown",
] as const;

/** One of the {@link ERROR_CATEGORIES}. */
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** What an error carries when it says what kind of failure it is. */
export interface Categorized {
  /** The kind of failure. */
  readonly category: ErrorCategory;
  /**
   * Whether the identical request, with nothing changed by anyone, may succeed
   * on a later attempt: a network failure, a timeout, a 429 or 5xx, a lock
   * another start holds, a server still starting. False for anything a person
   * has to change first.
   */
  readonly retryable: boolean;
  /** What to do about it, when the package that raised it knows. */
  readonly hint?: string | undefined;
  /** Structured facts about the failure, for a `--json` reader. */
  readonly details?: unknown;
}

/**
 * Closed set of failure categories the CLI can surface. Every error the
 * user sees is funnelled into one of these so messaging, exit codes, and
 * machine-readable output stay consistent regardless of where the failure
 * originated.
 */
export type ZitadelErrorCode =
  | "E_ALREADY_INIT"
  | "E_FRAMEWORK_NOT_DETECTED"
  | "E_UNSUPPORTED_PROJECT_SHAPE"
  | "E_NETWORK"
  | "E_AUTH"
  | "E_CONFLICT"
  | "E_LOCAL_SERVER_NOT_RUNNING"
  | "E_NOT_FOUND"
  | "E_PORT_IN_USE"
  | "E_VALIDATION"
  /**
   * A destructive action stopped for want of `--force` with nobody to ask.
   * Only a person can agree to it, so an agent asks them before it adds the
   * `--force` its suggested retry carries.
   */
  | "E_CONFIRMATION_REQUIRED"
  | "E_CREDENTIAL_MISSING"
  | "E_NOT_IMPLEMENTED"
  | "E_CANCELLED";

/**
 * Maps each {@link ZitadelErrorCode} to the process exit code the CLI
 * returns. The table is the single source of truth for exit semantics so
 * scripts and CI can branch on stable, documented numbers.
 */
export const EXIT_CODES: Record<ZitadelErrorCode, number> = {
  E_ALREADY_INIT: 0,
  E_FRAMEWORK_NOT_DETECTED: 3,
  E_UNSUPPORTED_PROJECT_SHAPE: 3,
  E_NETWORK: 4,
  E_AUTH: 1,
  E_CONFLICT: 5,
  E_LOCAL_SERVER_NOT_RUNNING: 4,
  E_NOT_FOUND: 4,
  E_PORT_IN_USE: 5,
  E_VALIDATION: 3,
  E_CONFIRMATION_REQUIRED: 3,
  E_CREDENTIAL_MISSING: 3,
  E_NOT_IMPLEMENTED: 2,
  // 128 + SIGINT, what a shell reports for a command stopped by Ctrl-C.
  E_CANCELLED: 130,
};

/**
 * The hint of an `E_CONFIRMATION_REQUIRED` refusal: the question the prompt
 * would have asked, for whoever runs the CLI to put to a person, and when
 * `--force` may follow.
 */
export function confirmationHint(question: string): string {
  return `Ask a person first: ${question} Pass --force only once they agree.`;
}

/**
 * Optional, user-facing extras attached to a {@link ZitadelError}. Kept
 * separate from the message so the renderer can present a hint, suggested
 * follow-up commands, and structured details independently (e.g. as JSON
 * fields) rather than concatenating everything into one string.
 */
export type ZitadelErrorOptions = {
  hint?: string;
  /**
   * What to run next. A {@link Suggested} rendered already, or a `Suggestion`
   * the command's failure handler renders with the run's scope, so one raised
   * below a command still aims at the run's project.
   */
  nextCommands?: readonly Suggested[];
  details?: unknown;
};

/**
 * The CLI's single error type. Carries a {@link ZitadelErrorCode} so the
 * top-level handler can derive an exit code and structured output without
 * pattern-matching on messages. Throwing this anywhere guarantees the user
 * gets a categorised, hint-bearing failure instead of a raw stack trace.
 */
export class ZitadelError extends Error {
  readonly code: ZitadelErrorCode;
  readonly hint?: string;
  readonly nextCommands?: readonly Suggested[];
  readonly details?: unknown;

  /**
   * The message this was raised with. `message` is not always it: oclif
   * rewrites the message of an error a flag's `parse` threw, prefixing the
   * flag and appending its own help line, so the words a refusal chose are
   * kept here for whoever reports it.
   */
  readonly raised: string;

  constructor(code: ZitadelErrorCode, message: string, opts: ZitadelErrorOptions = {}) {
    super(message);
    this.name = "ZitadelError";
    this.raised = message;
    this.code = code;
    this.hint = opts.hint;
    this.nextCommands = opts.nextCommands;
    this.details = opts.details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code] ?? 1;
  }
}

/**
 * The code each {@link ErrorCategory} is reported with.
 *
 * @remarks
 * `fault` and `unknown` have no code of their own yet, so they are reported
 * as `E_VALIDATION`, as every unrecognised error always was. Giving them their
 * own codes, with exit codes that no longer collide, is a separate decision;
 * this table is the one place it lands.
 */
const CATEGORY_CODES: Record<ErrorCategory, ZitadelErrorCode> = {
  invalid: "E_VALIDATION",
  missing: "E_NOT_FOUND",
  conflict: "E_CONFLICT",
  denied: "E_AUTH",
  unavailable: "E_NETWORK",
  fault: "E_VALIDATION",
  unknown: "E_VALIDATION",
};

/**
 * Where a failure is reported with a code other than the one its category has,
 * keyed by the class's name, and by `name:reason` for one reason of a class.
 *
 * @remarks
 * The boundary reads this and {@link CATEGORY_CODES} as data: a class that a
 * command words by name, or that keeps the code it always had, has a row here
 * and nothing else changes.
 */
const CODE_OVERRIDES: Record<string, ZitadelErrorCode> = {
  BackendUnsupportedError: "E_UNSUPPORTED_PROJECT_SHAPE",
  ConsentRequiredError: "E_CONFIRMATION_REQUIRED",
  EnvironmentFileMissingError: "E_VALIDATION",
  IdpProviderUnknownError: "E_VALIDATION",
  LocalServerBusyError: "E_CONFLICT",
  LocalServerDownError: "E_LOCAL_SERVER_NOT_RUNNING",
  LocalServerPortBusyError: "E_PORT_IN_USE",
  LocalServerPortFullError: "E_PORT_IN_USE",
  "LocalServerStopError:unlistable": "E_UNSUPPORTED_PROJECT_SHAPE",
  "OrcaFrameworkError:none": "E_FRAMEWORK_NOT_DETECTED",
  "OrcaFrameworkError:unknown": "E_FRAMEWORK_NOT_DETECTED",
  "OrcaFrameworkError:layout": "E_UNSUPPORTED_PROJECT_SHAPE",
  "OrcaFrameworkError:outdated": "E_UNSUPPORTED_PROJECT_SHAPE",
  OrcaPatchFileUnsupportedError: "E_VALIDATION",
  "OrcaRendererError:pending": "E_NOT_IMPLEMENTED",
  "PublishConnectionError:missing-variable": "E_CREDENTIAL_MISSING",
  ProjectFileMissingError: "E_VALIDATION",
};

/**
 * The code an operating-system refusal is reported with, by its errno, for a
 * failure that carries it in `details.code`: a permission failure is
 * `E_AUTH`, as it is for any other file the CLI reads.
 */
const ERRNO_CODES: Record<string, ZitadelErrorCode> = {
  EACCES: "E_AUTH",
  EPERM: "E_AUTH",
};

/**
 * What to do about a failure, as the CLI words it with its commands and flags,
 * which the library leaves out.
 */
type Advice = {
  /** What to do about it; the library's own hint when left out. */
  hint?: string | undefined;
  /** The commands to run next. */
  nextCommands?: readonly Suggested[] | undefined;
  /** The facts to report; the error's own when left out. */
  details?: unknown;
};

/** Words the advice for one kind of failure. */
type Adviser = (error: Error & Categorized) => Advice;

/**
 * An {@link Adviser} for one class, which its table key guarantees it is given.
 *
 * @param advise - Words the advice for the class.
 * @returns The adviser the table holds.
 */
function adviser<T extends Error & Categorized>(advise: (error: T) => Advice): Adviser {
  return (error) => {
    return advise(error as T);
  };
}

/**
 * What a row of a table keyed by class is found under.
 *
 * @param table - The table.
 * @param error - The failure.
 * @returns The row for the class and its reason, else the row for the class, else `undefined`.
 */
function lookup<T>(table: Readonly<Record<string, T>>, error: Error): T | undefined {
  const reason = "reason" in error && typeof error.reason === "string" ? error.reason : undefined;

  return (reason === undefined ? undefined : table[`${error.name}:${reason}`]) ?? table[error.name];
}

/**
 * What closes every refusal of a patch's preflight: `--force` is the obvious
 * next try after a conflict, and it changes nothing there.
 */
const PREFLIGHT_FORCE_NOTE =
  "--force can't fix this: it only replaces files at the paths setup writes.";

/**
 * The CLI's advice added to what a failure's own hint says.
 *
 * @param error - The failure.
 * @param advice - What the CLI adds.
 * @returns The two, joined.
 */
function afterHint(error: Error & Categorized, advice: string | undefined): Advice {
  const hint = [error.hint, advice]
    .filter((part) => {
      return part !== undefined;
    })
    .join(" ");

  return { hint: hint === "" ? undefined : hint };
}

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

/** The advice for the secret project file a command can restore. */
const RESTORE_SECRET: Advice = {
  hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
  nextCommands: [{ id: "doctor", flags: { fix: true } }],
};

/**
 * What to do about a failure, by the class that raised it, and by `name:reason`
 * for one reason of a class: the CLI's words and commands, which the library
 * leaves out. A class with no row reports its own hint.
 */
const ADVICE: Record<string, Adviser> = {
  ConsentRequiredError: adviser<ConsentRequiredError>((error) => {
    return {
      hint: confirmationHint(error.question),
      nextCommands: error.retry === undefined ? undefined : [error.retry],
      details: error.details ?? { question: error.question },
    };
  }),
  ZitadelConfigEditBreaksFlowsError: adviser<ZitadelConfigEditBreaksFlowsError>((error) => {
    return {
      hint: error.hint,
      nextCommands: error.dryRun ? [{ id: "deploy", flags: { dryRun: true } }] : undefined,
    };
  }),
  "OrcaFrameworkError:none": adviser<OrcaFrameworkError>((error) => {
    return afterHint(
      error,
      "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
    );
  }),
  "OrcaFrameworkError:mismatch": adviser<OrcaFrameworkError>((error) => {
    const { requested, detected, requestedName } = error.details ?? {};

    return afterHint(
      error,
      `Rerun setup without --framework, or with --framework ${String(detected)}, to set up this ` +
        `app, or point --cwd at the ${String(requestedName ?? requested)} app you meant. Setup never ` +
        "scaffolds a new app over one it detects, --force or not.",
    );
  }),
  "OrcaScaffoldBlockedError:occupied": adviser<OrcaScaffoldBlockedError>((error) => {
    return afterHint(
      error,
      "Pass --force to scaffold into a non-empty directory, or run setup from an existing " +
        "supported app project.",
    );
  }),
  OrcaPatchFileConflictError: adviser<OrcaPatchFileConflictError>((error) => {
    return afterHint(error, PATCH_FORCE_ADVICE[error.force]);
  }),
  "OrcaRendererError:pending": adviser<OrcaRendererError>((error) => {
    return afterHint(
      error,
      "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
    );
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
    return {
      hint: ENVIRONMENT_INVALID_ADVICE[error.reason](error),
    };
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

/** What to do about a request that got no usable response, by its reason. */
const NETWORK_HINTS: Record<string, string> = {
  "BackendUnavailableError:unreachable":
    "Check your connection and the server URL (ZITADEL_URL or --server).",
  "BackendUnavailableError:timeout":
    "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
  "BackendUnavailableError:unreadable":
    "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
};

/**
 * The code an operating-system refusal a failure carries is reported with.
 *
 * @param error - The failure.
 * @returns The code for its errno, or `undefined` when it carries none of them.
 */
function errnoCode(error: Error & Categorized): ZitadelErrorCode | undefined {
  const errno = isObject(error.details) ? error.details.code : undefined;

  return typeof errno === "string" ? ERRNO_CODES[errno] : undefined;
}

/**
 * oclif's footer under a command line it refused. It is oclif's own name for
 * what this CLI calls `Next:`, and finding it is the only way to tell one of
 * its parse errors from an ordinary failure: they arrive as plain `Error`s
 * carrying a rendered block rather than a type of their own.
 */
const OCLIF_HELP = /\n *See more help with --help\s*$/;

/** What oclif says of a flag typed twice, which carries no help footer of its own. */
const OCLIF_REPEATED = /^Flag --[\w-]+ can only be specified once$/u;

/** The heading oclif puts over the flags it rejected, which nothing else writes. */
const OCLIF_PREAMBLE = /^The following errors? occurred:\n/;

/** A failure's message as one sentence, which is how a person is shown it. */
export type FailureText = {
  /** What `Error: ` introduces, before the code in brackets. Said once, wherever the failure is drawn. */
  readonly sentence: string;
  /** The command line itself was refused, so `--help` is what to run next. */
  readonly misuse: boolean;
};

/**
 * A failure's message as the CLI says it to a person.
 *
 * It is the human rendering alone: `--json` carries `message` exactly as it
 * was thrown, so a script that matches on it is unaffected by anything here.
 *
 * The message is said as it was thrown: a failure reads the same in the
 * envelope's `message` and on a terminal, so nothing is capitalised or trimmed
 * on the way. Only oclif's own rendering of a refused command line — a heading,
 * an indented reason and a `--help` footer — is folded back into the one
 * sentence the CLI states every other failure as, with the footer handed to
 * the caller as {@link FailureText.misuse} so it can be offered under `Next:`
 * like any other command the CLI suggests.
 */
export function failureText(message: string): FailureText {
  if (OCLIF_REPEATED.test(message)) {
    return {
      sentence: message,
      misuse: true,
    };
  }
  if (!OCLIF_HELP.test(message)) {
    return {
      sentence: message,
      misuse: false,
    };
  }
  const [head = "", ...rest] = stripAnsi(message.replace(OCLIF_HELP, ""))
    .replace(OCLIF_PREAMBLE, "")
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line !== "";
    });
  const listed = rest.map((line) => {
    return line.split(/\s{2,}/)[0] ?? line;
  });

  return {
    sentence: head.endsWith(":")
      ? `${head} ${listed.join(", ")}`.trim()
      : [head, ...rest].join("; "),
    misuse: true,
  };
}

/**
 * Normalises any thrown value into a {@link ZitadelError}. Inspection is
 * ordered most-specific-first (already-normalised, HTTP status, then
 * errno/filesystem, no response, Zod-like, generic `Error`, then a
 * catch-all) so the most actionable category and hint win. A cancelled
 * request arrives already normalised, as the `E_CANCELLED` error that
 * `./interrupt` aborts it with. This is the boundary that lets the rest
 * of the CLI `throw` plain errors yet still produce consistent, categorised
 * output. The original error shape is preserved under `details` for
 * debugging without leaking it into the user-facing message.
 */
export function toZitadelError(error: unknown): ZitadelError {
  if (error instanceof ZitadelError) {
    return error;
  }

  // The run being stopped, by a prompt walked away from or by anything else
  // that aborts, is the person's decision and not a failure.
  if (isAbortError(error)) {
    return new ZitadelError("E_CANCELLED", "Cancelled by user");
  }

  if (error instanceof BackendError) {
    return fromBackendError(error);
  }

  // An error a package raised on purpose says what kind of failure it is, and
  // the tables above say where it is reported differently and what to do.
  if (isCategorized(error)) {
    const advice = lookup(ADVICE, error)?.(error) ?? { hint: error.hint };
    const details = advice.details ?? error.details;
    const code =
      lookup(CODE_OVERRIDES, error) ?? errnoCode(error) ?? CATEGORY_CODES[error.category];

    return new ZitadelError(code, error.message, {
      ...(advice.hint === undefined ? {} : { hint: advice.hint }),
      ...(advice.nextCommands === undefined ? {} : { nextCommands: advice.nextCommands }),
      ...(details === undefined ? {} : { details }),
    });
  }

  if (isErrnoException(error)) {
    const details = { original: pickErrorShape(error) };
    if (error.code === "EACCES" || error.code === "EPERM") {
      return new ZitadelError("E_AUTH", `Permission denied: ${error.message}`, {
        hint: "Check file permissions or run with the right user.",
        details,
      });
    }
    if (error.code === "EEXIST") {
      return new ZitadelError("E_CONFLICT", error.message, {
        hint: "A file already exists. Use --force to overwrite or remove it first.",
        details,
      });
    }
    if (error.code === "ENOENT") {
      return new ZitadelError("E_VALIDATION", error.message, {
        hint: "A required file or directory is missing.",
        details,
      });
    }
  }

  if (isZodLikeError(error)) {
    return new ZitadelError("E_VALIDATION", errorMessage(error), {
      details: { issues: (error as { issues: unknown }).issues },
    });
  }

  if (error instanceof Error) {
    return new ZitadelError("E_VALIDATION", error.message, {
      details: { original: pickErrorShape(error) },
    });
  }

  return new ZitadelError("E_VALIDATION", "Unknown error", { details: error });
}

/**
 * A {@link BackendError} as the CLI's error. One the server answered carries
 * its status, and is classified by it; one the backend raised itself carries
 * its class, and its message, hint and details as they were given.
 */
function fromBackendError(error: BackendError): ZitadelError {
  const network = lookup(NETWORK_HINTS, error);
  if (network !== undefined) {
    return new ZitadelError("E_NETWORK", error.message, {
      hint: network,
      details: { url: error.url, reason: "reason" in error ? error.reason : undefined },
    });
  }
  const code = lookup(CODE_OVERRIDES, error) ?? CATEGORY_CODES[error.category];
  if (error.status === undefined || error.url === undefined) {
    return new ZitadelError(code, error.message, {
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  const { status, url } = error;
  const details = { status, url, body: error.body };
  if (error.status === 404) {
    // A 404 carrying the platform's error envelope (a `code` field) is a
    // domain-level miss from a real Zitadel API — an unknown schema or
    // project id — except `req.not_found`, which the server answers for a
    // path no operation of its version has (ADR 076). Without the envelope
    // the endpoint itself is missing: the CLI is pointed at a server that
    // isn't a Zitadel platform API.
    if (error.serverCode === "req.not_found") {
      return new ZitadelError(
        "E_NOT_FOUND",
        `${error.url} has no such endpoint on this Zitadel server`,
        {
          hint: "The server and this CLI are different versions; a server from before the API moved under /api/v1 answers every call so. Run the CLI release that matches the server, or upgrade the server.",
          details,
        },
      );
    }
    const wrongServer = error.serverCode === undefined;
    const message = wrongServer
      ? `${error.message} — ${error.url} has no such endpoint; is this a Zitadel platform API?`
      : error.message;

    return new ZitadelError("E_NOT_FOUND", message, { details });
  }
  // Which code a status gets was decided once, where the response became a
  // backend error: a 409 is a conflict, a 410 is gone, a 429 or a 5xx is worth
  // retrying, an origin the project does not hold is a refused target and not
  // a bad credential. The category it carries is that decision.
  // The platform names the fields it rejected, and the message does not
  // repeat them: `idp.field_immutable` says only "the field is fixed for the
  // life of the connection", which leaves the reader to guess which of a
  // connection document's fields it meant. Promoting them to the hint puts
  // the answer where the failure is read, not only in `--json`. The same
  // goes for what a refusal says is missing: `idp.endpoints_partial` names
  // the endpoints a connection left out only in `missing`.
  const fields = listedInDetails(error.body, "fields");
  const missing = listedInDetails(error.body, "missing");
  const resources = rejectedResources(error.body);
  const hint = [
    ...(resources.length > 0 ? [`${resources.join("; ")}.`] : []),
    ...(fields.length > 0
      ? [
          `The server rejected ${new Intl.PluralRules("en").select(fields.length) === "one" ? "this field" : "these fields"}: ${fields.join(", ")}.`,
        ]
      : []),
    ...(missing.length > 0
      ? [
          `The server reports ${new Intl.PluralRules("en").select(missing.length) === "one" ? "this endpoint" : "these endpoints"} missing: ${missing.join(", ")}.`,
        ]
      : []),
  ].join(" ");

  return new ZitadelError(code, error.message, {
    ...(hint !== "" ? { hint } : {}),
    details,
  });
}

/**
 * True when a response body looks like the platform's structured error
 * envelope (`{ code, message, … }`). Its presence proves the request reached
 * a real Zitadel platform API rather than an arbitrary HTTP server.
 */
/**
 * The names a platform error envelope lists under `key`, if any: the dotted
 * field paths it blames (`fields`), or what it reports missing (`missing`).
 *
 * The envelope nests them under `details`, and the server wraps its own
 * `details` map in the response's `details` field, so the names arrive at
 * `body.details.details.<key>`. Both depths are read: the extra wrapper is
 * the serialiser's doing rather than part of the contract, and a reader that
 * insisted on it would go silent the day it goes away.
 */
function listedInDetails(
  body: unknown,
  key: "fields" | "missing",
  seen = new Set<string>(),
  depth = 0,
): string[] {
  if (depth >= 4 || !isObject(body)) {
    return [...seen];
  }
  const listed = (body as Record<string, unknown>)[key];
  if (Array.isArray(listed)) {
    for (const name of listed) {
      if (typeof name === "string" && name !== "") {
        seen.add(name);
      }
    }
  }

  return listedInDetails((body as { details?: unknown }).details, key, seen, depth + 1);
}

/**
 * The resources a refusal names, one line each: `<kind> <handle>: <message>`.
 * A rejected release carries the reason per schema or flow under
 * `details.resources`, and the top-level message only says the release was
 * invalid, so without these lines the reason shows only in `--json`. A flow
 * keeps its reason in the resource's own `details.details`, behind a generic
 * message, so that text is appended when the message does not already hold it.
 * A connection names what it refused there too, as a list: the fields an
 * `idp.field_immutable` blames, or the endpoints an `idp.endpoints_partial`
 * reports missing. Those are appended the same way.
 */
function rejectedResources(body: unknown, depth = 0): readonly string[] {
  if (depth >= 4 || !isObject(body)) {
    return [];
  }
  const listed = (body as Record<string, unknown>).resources;
  if (Array.isArray(listed)) {
    return listed.flatMap((item) => {
      return resourceLine(item) ?? [];
    });
  }
  return rejectedResources((body as { details?: unknown }).details, depth + 1);
}

function resourceLine(item: unknown): string | undefined {
  if (!isObject(item)) {
    return undefined;
  }
  const { kind, handle, message, details } = item as Record<string, unknown>;
  const reason = typeof message === "string" ? message : "";
  const nested = isObject(details) ? (details as Record<string, unknown>).details : undefined;
  const detail =
    typeof nested === "string"
      ? nested
      : [...listedInDetails(details, "fields"), ...listedInDetails(details, "missing")].join(", ");
  const text =
    detail === "" || reason.includes(detail) ? reason : [reason, detail].filter(Boolean).join(": ");
  if (text === "") {
    return undefined;
  }
  const subject = [kind, handle]
    .filter((part) => {
      return typeof part === "string" && part !== "";
    })
    .join(" ");

  return subject === "" ? text : `${subject}: ${text}`;
}

/**
 * Whether `error` is an `AbortError`: the platform's way to say an operation
 * was stopped, which is what the run's signal rejects with and what a prompt
 * the person walked away from throws.
 *
 * @param error - Whatever was caught.
 * @returns True for an error named `AbortError`.
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Whether `error` is the run being cancelled, which a caller that swallows
 * failures must still let through: the person asked the command to stop, so a
 * best-effort read that failed because of it has nothing to report, and
 * reporting one would have the command carry on and exit as though it had
 * finished. The counterpart of `isRefusal`, for the other failure nothing may
 * turn into an outcome.
 *
 * `Interruptible` aborts the run's signal with an `AbortError`, so every
 * request bound to it rejects with that; the `E_CANCELLED` error is the
 * boundary's own report of it, and counts too.
 *
 * @param error - Whatever was caught.
 * @returns True for an `AbortError` or an `E_CANCELLED` error.
 */
export function isCancellation(error: unknown): boolean {
  return isAbortError(error) || (error instanceof ZitadelError && error.code === "E_CANCELLED");
}

/**
 * Whether a caught value is an error that says what kind of failure it is.
 *
 * @param error - Whatever was caught.
 * @returns True for an `Error` whose `category` is one of {@link ERROR_CATEGORIES}.
 */
export function isCategorized(error: unknown): error is Error & Categorized {
  return (
    error instanceof Error &&
    ERROR_CATEGORIES.some((category) => {
      return category === (error as Partial<Categorized>).category;
    })
  );
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function isZodLikeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  );
}

/** The message of a caught value, whatever it is. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function pickErrorShape(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    code: (error as NodeJS.ErrnoException).code,
  };
}
