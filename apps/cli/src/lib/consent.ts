import type { ZitadelClient as FullClient } from "@zitadel/api/client";
import { destructiveOperations } from "@zitadel/api/generated/operations";

import type { ZitadelClient } from "./api-client";
import { ZitadelError } from "./errors";
import { input } from "./input";
import type { SuggestedCommand } from "./suggestion";

/**
 * What a destructive command does, as one word. It is the stable token of the
 * skipped envelope a declined prompt ends in (`remove-cancelled`), so it is a
 * closed list: a new action is added here, not spelled at the call site.
 */
export type Verb =
  | "call"
  | "deactivate"
  | "delete"
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
   * Refuses in place of the default "Cannot … without --force" when nobody
   * can be asked and `--force` was not given, for a refusal that says more.
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
}>;

/** Refusals {@link Consent.request} threw, so a best-effort caller can let them through. */
const refusals = new WeakSet<object>();

/** Every consent {@link Consent.request} made, which {@link Consent.assert} checks for. */
const granted = new WeakSet<object>();

/** The client functions a narrowed client refuses. */
const WITHHELD: ReadonlySet<string> = new Set(destructiveOperations);

/** Each narrowed client's full client, which only {@link Consent.unlock} reads. */
const fullClients = new WeakMap<object, FullClient>();

/**
 * The client without its destructive operations, at run time as in its type:
 * reaching one throws, however it is reached (a cast, `Reflect.get`, an
 * `any`), and only {@link Consent.unlock} hands back the full client.
 * `createZitadelClient` narrows every client it makes.
 */
export function withholdDestructive(client: FullClient): ZitadelClient {
  const narrowed = new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === "string" && WITHHELD.has(property)) {
        throw new Error(`${property} is destructive: reach it through a Consent`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  fullClients.set(narrowed, client);
  return narrowed;
}

/**
 * Proof that a person, or `--force`, agreed to one destructive action. Every
 * destructive operation takes one: the client's (`deleteVariable`,
 * `revokeRelease`; the spec marks them) are reached only through
 * {@link unlock}, and the local ones (`LocalServer.reset`, `eject`'s
 * removals) take it as a parameter.
 *
 * Only {@link request} makes one: the constructor is private, and a private
 * member makes the type nominal, so an object of the same shape is not a
 * `Consent`. A cast to it is a lint error, and {@link assert} checks at run
 * time that {@link request} made it, for what reaches it untyped.
 *
 * When the `Mutating` tier gives every write its own permission, consent is
 * the stronger of the two: whatever takes that permission takes a consent.
 */
export class Consent {
  /** Makes the type nominal: no object of the same shape is a `Consent`. */
  declare private readonly nominal: never;

  private constructor() {
    granted.add(this);
  }

  /**
   * Ask for consent. `--force` gives it without asking; with nobody to ask
   * and no `--force` the gate refuses (an `E_VALIDATION` naming `--force`);
   * otherwise the person is asked, and `undefined` is their no. Ctrl-C
   * throws `E_CANCELLED`, as every prompt does.
   *
   * A dry run must answer before asking: it is a bug to ask during one, and
   * it throws rather than hand a dry run the means to change anything.
   */
  static async request(gate: Gate, session: ConsentSession): Promise<Consent | undefined> {
    if (session.dryRun) {
      throw new Error(`A dry run asked for consent to ${gate.name}`);
    }
    try {
      if (!session.force && !session.interactive) {
        gate.refuse?.();
      }
      const agreed = await input(
        { kind: "confirm", name: gate.name, message: gate.message, retry: gate.retry },
        session,
      );
      return agreed ? new Consent() : undefined;
    } catch (error) {
      if (error instanceof ZitadelError && error.code === "E_VALIDATION") {
        refusals.add(error);
      }
      throw error;
    }
  }

  /** Throws unless `value` is a `Consent` {@link request} made. */
  static assert(value: unknown): asserts value is Consent {
    if (typeof value !== "object" || value === null || !granted.has(value)) {
      throw new Error("A destructive operation ran without consent");
    }
  }

  /** The client with its destructive operations, which only consent reaches. */
  unlock(client: ZitadelClient): FullClient {
    Consent.assert(this);
    const full = fullClients.get(client);
    if (full === undefined) {
      throw new Error("Only a client createZitadelClient made can be unlocked");
    }
    return full;
  }
}

/**
 * Whether `error` is a gate refusing for want of `--force`, which a caller
 * that swallows failures (`doctor --fix`) must still let through: the run
 * did not do what was asked, and only the person can say yes.
 */
export function isRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && refusals.has(error);
}
