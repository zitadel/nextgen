import { ZitadelError } from "@/lib/errors";
import { Ui } from "@/lib/ui";
import type { SuggestedCommand } from "@/lib/suggestion";
import type { Confirmer } from "@/lib/ui/questions";

/**
 * What a destructive command does, as one word. It is the stable token of the
 * skipped envelope a declined prompt ends in (`remove-cancelled`), so it is a
 * closed list: a new action is added here, not spelled at the call site.
 */
export type Verb =
  | "call"
  | "cancel"
  | "deactivate"
  | "delete"
  | "deploy"
  | "disable"
  | "eject"
  | "remove"
  | "replace"
  | "reset"
  | "revoke"
  | "rollback";

/** What a confirmation asks, and how it refuses when nobody can be asked. */
export type Gate = Readonly<{
  verb: Verb;
  /**
   * The action as a lowercase phrase, which completes "Cannot … without
   * --force": `remove MY_VAR from the project`.
   */
  name: string;
  /** The question as the prompt shows it. */
  message: string;
  /** The command again with `--force`, for an agent to run. */
  retry?: SuggestedCommand;
  /**
   * The leading arguments the `--force` retry names in place of the typed
   * ones, for a command that resolved what the invocation left out (a bare
   * `deployment rollback`), so the retry acts on what the question named.
   */
  arguments?: readonly string[];
  /**
   * Refuses in place of the default "Cannot … without --force" when nobody
   * can be asked and `--force` was not given, for a refusal that says more.
   * It throws an `E_CONFIRMATION_REQUIRED` too, or {@link Consent.isRefusal} misses it.
   */
  refuse?: () => never;
}>;

/** Who can answer, and whether the run may change anything at all. */
export type ConsentSession = Readonly<{
  interactive: boolean;
  /** The command's `--force`, which answers yes without asking. */
  force: boolean;
  /** A dry run never consents: it changes nothing, so it has nothing to confirm. */
  dryRun: boolean;
  /**
   * What asks the person, drawn the way the command presents itself. It also
   * answers for `--force` and refuses when nobody can be asked, so the gate
   * and the question cannot disagree about either. A caller with no command
   * to draw for leaves it out and gets the wizard's prompt.
   */
  confirmer?: Confirmer;
}>;

/** Refusals {@link Consent.request} threw, so a best-effort caller can let them through. */
const refusals = new WeakSet<object>();

/** Every consent {@link Consent.request} made, which {@link Consent.assert} checks for. */
const granted = new WeakSet<object>();

/**
 * Proof that a person, or `--force`, agreed to one destructive action. A
 * command asks for it before it deletes, revokes or rolls back anything; the
 * local actions (`LocalRuntime.reset`, `eject`'s removals) take it as a
 * parameter.
 *
 * Only {@link Consent.request} makes one: the constructor is private, and a private
 * member makes the type nominal, so an object of the same shape is not a
 * `Consent`. A cast to it is a lint error, and {@link Consent.assert} checks at run
 * time that {@link Consent.request} made it, for what reaches it untyped.
 *
 * When the `Mutating` tier gives every write its own permission, consent is
 * the stronger of the two: whatever takes that permission takes a consent.
 */
export class Consent {
  /** Makes the type nominal: no object of the same shape is a `Consent`. */
  declare private readonly nominal: never;

  /** Private so {@link Consent.request} is the only way to make one. */
  private constructor() {}

  /**
   * Ask for consent. `--force` gives it without asking; with nobody to ask
   * and no `--force` the gate refuses (an `E_CONFIRMATION_REQUIRED` naming
   * `--force`, which only a person may agree to);
   * otherwise the person is asked, and `undefined` is their no. Ctrl-C
   * throws `E_CANCELLED`, as every prompt does.
   *
   * A dry run must answer before asking: it is a bug to ask during one, and
   * it throws rather than hand a dry run the means to change anything.
   *
   * @param gate - What is being confirmed and how it refuses.
   * @param session - Who can answer, and whether the run may change anything.
   * @returns The consent, or `undefined` when the person said no.
   * @throws {ZitadelError} `E_CONFIRMATION_REQUIRED` when nobody can be asked
   * and `--force` was not given, or `E_CANCELLED` on Ctrl-C.
   * @throws {Error} When a dry run asks.
   */
  static async request(gate: Gate, session: ConsentSession): Promise<Consent | undefined> {
    if (session.dryRun) {
      throw new Error(`A dry run asked for consent to ${gate.name}`);
    }
    try {
      if (!session.force && !session.interactive) {
        gate.refuse?.();
      }
      const agreed = await (session.confirmer ?? Ui.asker(session)).confirm({
        name: gate.name,
        message: gate.message,
        retry: gate.retry,
      });
      if (!agreed) {
        return undefined;
      }
      // Recorded here rather than in the constructor, which `Reflect.construct`
      // reaches around its TypeScript-only privacy.
      const consent = new Consent();
      granted.add(consent);
      return consent;
    } catch (error) {
      if (error instanceof ZitadelError && error.code === "E_CONFIRMATION_REQUIRED") {
        refusals.add(error);
      }
      throw error;
    }
  }

  /**
   * Throws unless `value` is a `Consent` {@link Consent.request} made.
   *
   * @param value - What claims to be a consent.
   * @throws {Error} When `value` is not one {@link Consent.request} made.
   */
  static assert(value: unknown): asserts value is Consent {
    if (typeof value !== "object" || value === null || !granted.has(value)) {
      throw new Error("A destructive operation ran without consent");
    }
  }

  /**
   * Whether `error` is a gate refusing for want of `--force`, which a caller
   * that swallows failures (`doctor --fix`) must still let through: the run
   * did not do what was asked, and only the person can say yes.
   *
   * @param error - Whatever was thrown.
   * @returns Whether {@link Consent.request} threw it as a refusal.
   */
  static isRefusal(error: unknown): boolean {
    return typeof error === "object" && error !== null && refusals.has(error);
  }
}
