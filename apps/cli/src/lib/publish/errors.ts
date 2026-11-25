import { codeOf } from "@/lib/errors";
import type { Categorized, ErrorCategory, Suggested, ZitadelErrorCode } from "@/lib/errors";

/**
 * What a publish failure carries beyond its message.
 */
export type PublishErrorOptions = {
  /**
   * What to do about it, in words that name no command or flag.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * What to run next, as suggestion objects the failure handler renders.
   */
  readonly nextCommands?: readonly Suggested[] | undefined;

  /**
   * The error that caused this one.
   */
  readonly cause?: unknown;
};

/**
 * Anything publishing a configuration refuses with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export class PublishError extends Error implements Categorized {
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return codeOf(this.category);
  }

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * What to run next, as suggestion objects the failure handler renders with the
   * run's scope.
   */
  readonly nextCommands: readonly Suggested[] | undefined;

  /**
   * Make a publish failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: PublishErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
    this.nextCommands = options.nextCommands;
  }
}

/**
 * Where a publish fails the configuration before anything is sent, as
 * the findings that stopped it.
 */
export type PublishFinding = {
  /** The rule that found it. */
  readonly rule: string;

  /** The file it is in. */
  readonly path: string;

  /** The steps of the flow it concerns, when the rule named any. */
  readonly steps?: readonly unknown[] | undefined;

  /** What is wrong. */
  readonly message: string;
};

/**
 * What a refused configuration needs the command to word its advice.
 */
export type PublishConfigInvalidOptions = PublishErrorOptions & {
  /**
   * Every finding that stopped the publish.
   */
  readonly findings: readonly PublishFinding[];

  /**
   * Whether one of them is a secret written into a file.
   */
  readonly literalSecret: boolean;

  /**
   * Whether one of them is a key this CLI does not know, which a newer server
   * may declare.
   */
  readonly refusedKey: boolean;
};

/**
 * The configuration has errors, so nothing was sent.
 */
export class PublishConfigInvalidError extends PublishError {
  /**
   * Every finding that stopped the publish.
   */
  readonly findings: readonly PublishFinding[];

  /**
   * Whether one of them is a secret written into a file.
   */
  readonly literalSecret: boolean;

  /**
   * Whether one of them is a key this CLI does not know.
   */
  readonly refusedKey: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings and what they say about the fix.
   */
  constructor(message: string, options: PublishConfigInvalidOptions) {
    const fix = options.literalSecret
      ? 'Publish a secret with the command below and reference it as "${{ NAME }}".'
      : "Fix the files named above and rerun; no changes were made.";
    super(message, {
      ...options,
      hint: options.refusedKey
        ? `${fix} A key a newer Zitadel server added needs a CLI as new as the server.`
        : fix,
      details: options.details ?? { issues: options.findings },
      nextCommands: options.literalSecret
        ? [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }]
        : undefined,
    });
    this.findings = options.findings;
    this.literalSecret = options.literalSecret;
    this.refusedKey = options.refusedKey;
  }
}

/**
 * What is wrong with the variable a connection names: `shared-variable` is one
 * variable named for both the client id and the secret, `wrong-kind` a variable
 * that is a secret where it must not be or the reverse, and `missing-variable`
 * a variable the project does not have.
 */
export type PublishConnectionReason = "shared-variable" | "wrong-kind" | "missing-variable";

/**
 * What a refused connection needs the command to word its advice.
 */
export type PublishConnectionOptions = PublishErrorOptions & {
  /**
   * The connection file.
   */
  readonly file: string;

  /**
   * The variable it names.
   */
  readonly variable: string;

  /**
   * The credential field that names it; absent when two fields share it.
   */
  readonly field?: "client_id" | "client_secret" | undefined;

  /**
   * Whether the variable the project holds is a secret, when it holds one.
   */
  readonly isSecret?: boolean | undefined;

  /**
   * Which kind of publish was refused.
   */
  readonly mode?: "deploy" | "preview" | undefined;
};

/** What to do about a refused connection, by why: the hint and the command that publishes the variable. */
const CONNECTION_ADVICE: Record<
  PublishConnectionReason,
  (wantsSecret: boolean, publish: Suggested) => PublishErrorOptions
> = {
  "shared-variable": () => {
    return {
      hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
    };
  },
  "wrong-kind": (wantsSecret, publish) => {
    return {
      hint: wantsSecret
        ? "The client secret must be a secret variable: publish it with the command below."
        : "The client id must be a plain variable the engine can read back: publish it as a plain variable with the command below.",
      nextCommands: [publish],
    };
  },
  "missing-variable": (_wantsSecret, publish) => {
    return {
      hint: "Publish it with the command below, then deploy again.",
      nextCommands: [publish],
    };
  },
};

/**
 * A connection names a variable the project cannot supply as the field needs.
 */
export class PublishConnectionError extends PublishError {
  override readonly category: ErrorCategory;
  override readonly retryable: boolean = false;

  /** The stable product code: a variable the project lacks is a missing credential. */
  override get code(): ZitadelErrorCode {
    return this.reason === "missing-variable" ? "E_CREDENTIAL_MISSING" : super.code;
  }

  /**
   * What is wrong with the variable.
   */
  readonly reason: PublishConnectionReason;

  /**
   * The connection file.
   */
  readonly file: string;

  /**
   * The variable it names.
   */
  readonly variable: string;

  /**
   * The credential field that names it.
   */
  readonly field: "client_id" | "client_secret" | undefined;

  /**
   * Whether the variable the project holds is a secret.
   */
  readonly isSecret: boolean | undefined;

  /**
   * Which kind of publish was refused.
   */
  readonly mode: "deploy" | "preview" | undefined;

  /**
   * Make the failure.
   *
   * @param reason - What is wrong with the variable.
   * @param message - What went wrong.
   * @param options - The connection, the variable and the facts behind them.
   */
  constructor(reason: PublishConnectionReason, message: string, options: PublishConnectionOptions) {
    const wantsSecret = options.field === "client_secret";
    const publish: Suggested = {
      id: "variable:set",
      args: { name: options.variable },
      flags: { secret: wantsSecret, preview: options.mode === "preview" },
    };
    super(message, {
      ...options,
      ...CONNECTION_ADVICE[reason](wantsSecret, publish),
    });
    this.reason = reason;
    this.category = reason === "missing-variable" ? "conflict" : "invalid";
    this.file = options.file;
    this.variable = options.variable;
    this.field = options.field;
    this.isSecret = options.isSecret;
    this.mode = options.mode;
  }
}

/**
 * The release the files make is not one the API takes, so nothing was sent.
 */
export class PublishReleaseRejectedError extends PublishError {}
