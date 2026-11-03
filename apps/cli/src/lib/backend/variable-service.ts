import type { GetVariables200 } from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { escapeControlCharacters, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { ZitadelError } from "../errors";
import { valuesOfKind, type VariableKind, type VariableValue } from "../variables";

type Scalar = string | number | boolean;

/** What one kind of a name holds: a value, or the fact that a secret is held. */
type Held = Readonly<{ secret: boolean; value?: Scalar }>;

/** A value to write: a secret is stored but never read back. */
export type VariableWrite = Readonly<{ value: Scalar; secret: boolean }>;

/** What a name holds in each kind, as a write or a read leaves it. */
export type VariableState = Readonly<Record<VariableKind, Variable | undefined>>;

/** Stands in for a secret's value, which the platform never discloses. */
const SECRET_MARKER = "(secret)";

/** Stands in for a kind the name holds no value for at all. */
const NO_VALUE = "-";

/**
 * Names the platform accepts, from `variable-name.yaml`: word characters only,
 * which is exactly what the `${{ NAME }}` reference syntax can address
 * (ADR 062 §2).
 */
const NAME_PATTERN = /^\w+$/;

/** Longest name the same schema accepts. */
const NAME_MAX_LENGTH = 255;

function heldOf(wire: VariableValue): Held {
  return typeof wire === "object" && wire !== null
    ? { secret: true }
    : { secret: false, value: wire };
}

/**
 * Render a stored scalar for a terminal.
 *
 * A value is attacker-influenceable, since anyone holding `variable.write`
 * chooses it, so it is never interpolated raw. The client already escapes what
 * could drive the terminal; this also escapes a newline and a tab, which would
 * break the table out of its own row.
 */
function render(value: Scalar | undefined): string {
  return typeof value === "string"
    ? escapeControlCharacters(value, { keepLayout: false })
    : String(value);
}

/**
 * A variable as the platform reports it: a name, the value it holds, and the
 * preview value beside it when the read covers both kinds.
 *
 * @remarks
 * A Value Object (Fowler, PoEAA): immutable and compared by content. A secret
 * is held without a value, because a read never discloses one (ADR 062 §7), so
 * a secret has no value to print and prints a marker instead. It serialises to
 * the plain record the JSON output carries.
 */
export class Variable {
  readonly name: string;
  readonly secret: boolean;
  declare readonly value?: Scalar;
  declare readonly preview?: Held;

  private constructor(name: string, primary: Held | undefined, preview: Held | undefined) {
    this.name = name;
    this.secret = primary?.secret ?? false;
    if (primary?.value !== undefined) {
      this.value = primary.value;
    }
    if (preview !== undefined) {
      this.preview = preview;
    }
    Object.freeze(this);
  }

  /** One name with the value it holds in a single kind. */
  static of(name: string, wire: VariableValue): Variable {
    return new Variable(name, heldOf(wire), undefined);
  }

  /** The values of one kind as variables, sorted by name so output is stable between runs. */
  static fromValues(values: Record<string, VariableValue>): Variable[] {
    return Object.entries(values)
      .map(([name, wire]) => Variable.of(name, wire))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Every name on the project with the primary value it holds and the preview
   * value beside it, sorted by name. A name is listed when either kind holds a
   * value, so a preview-only name does not disappear (#1617).
   */
  static inventory(body: GetVariables200): Variable[] {
    return Object.entries(body)
      .map(([name, byKind]) => {
        const primary = byKind.primary === undefined ? undefined : heldOf(byKind.primary);
        const preview = byKind.preview === undefined ? undefined : heldOf(byKind.preview);
        return new Variable(name, primary, preview);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The cells of a table with one value column. Every value is escaped for the terminal. */
  cell(): { name: string; value: string } {
    return { name: this.name, value: this.secret ? SECRET_MARKER : render(this.value) };
  }

  /**
   * {@link Variable.cell} plus the preview column. A kind the name holds nothing
   * for prints `-`, because an empty cell would read as an empty value.
   */
  inventoryCell(): { name: string; value: string; preview: string } {
    const show = (held: Held | undefined): string => {
      if (held === undefined) {
        return NO_VALUE;
      }
      if (held.secret) {
        return SECRET_MARKER;
      }
      return held.value === undefined ? NO_VALUE : render(held.value);
    };
    return {
      name: this.name,
      value: show(this.value === undefined && !this.secret ? undefined : this),
      preview: show(this.preview),
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      secret: this.secret,
      ...(this.value === undefined ? {} : { value: this.value }),
      ...(this.preview === undefined ? {} : { preview: this.preview }),
    };
  }
}

/**
 * The variables of one project, each holding a value per kind, primary and
 * preview.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * Every operation that takes a name refuses one the platform would refuse, so a
 * bad name can never reach the server by any route.
 */
export class VariableService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * Refuse a name the platform would refuse, quoting it so a newline or an
   * escape sequence in it cannot reach the terminal.
   *
   * @throws ZitadelError `E_VALIDATION` naming what is wrong with the name.
   */
  static assertName(name: string): void {
    if (!NAME_PATTERN.test(name)) {
      throw new ZitadelError("E_VALIDATION", `Invalid variable name ${JSON.stringify(name)}.`, {
        hint: "A variable name contains only letters, digits and underscores.",
      });
    }
    if (name.length > NAME_MAX_LENGTH) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Variable name is ${name.length} characters; the limit is ${NAME_MAX_LENGTH}.`,
        { hint: "Shorten the name." },
      );
    }
  }

  /** The kinds a write sets: the platform's rule for where a plain value and a secret go. */
  static kindsWritten(secret: boolean, kind?: "preview"): VariableKind[] {
    if (kind === "preview") {
      return ["preview"];
    }
    return secret ? ["primary"] : ["primary", "preview"];
  }

  /** The kinds a removal clears: the preview value alone, or both. */
  static kindsRemoved(kind?: "preview"): VariableKind[] {
    return kind === "preview" ? ["preview"] : ["primary", "preview"];
  }

  /**
   * The variables of the project. Without a kind, every name with its primary
   * value and the preview value beside it; with one, only the names that hold a
   * value of that kind.
   */
  async list(kind?: VariableKind): Promise<readonly Variable[]> {
    if (kind === undefined) {
      return Variable.inventory(await this.client.getVariables({ project_id: this.projectId }));
    }
    const held = await this.read(kind);
    return Variable.fromValues(valuesOfKind(held, kind));
  }

  /**
   * Read one variable in the given kind.
   *
   * @throws ZitadelError `E_NOT_FOUND` when the name holds no value of that kind.
   */
  async get(name: string, kind: VariableKind): Promise<Variable> {
    VariableService.assertName(name);
    const held = await this.client.getVariable(name, { project_id: this.projectId, kind });
    const wire = held[kind];
    if (wire === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `Variable ${name} has no ${kind} value.`, {
        hint:
          kind === "preview"
            ? "A name has a preview value only once one is set with `--preview`."
            : "Set one with `variable set`.",
      });
    }
    return Variable.of(name, wire);
  }

  /**
   * Set one name. Without a kind a plain value is stored for both kinds and a
   * secret for the primary kind only; `preview` writes the preview kind alone.
   *
   * @returns What the name holds in each kind afterwards. The write answers with
   * the kinds it touched, and the kind it did not touch is read separately,
   * because the platform never merges the two kinds in one answer.
   */
  async set(name: string, write: VariableWrite, kind?: "preview"): Promise<VariableState> {
    VariableService.assertName(name);
    const scope =
      kind === undefined ? { project_id: this.projectId } : { project_id: this.projectId, kind };
    const written = (await this.client.updateVariables({ [name]: write }, scope))[name] ?? {};
    const stateOf = async (of: VariableKind): Promise<Variable | undefined> => {
      const wire = written[of] ?? (await this.read(of))[name]?.[of];
      return wire === undefined ? undefined : Variable.of(name, wire);
    };
    return Object.freeze({ primary: await stateOf("primary"), preview: await stateOf("preview") });
  }

  /**
   * Remove one name: its preview value alone, or both kinds.
   *
   * @returns The kinds cleared.
   */
  async remove(consent: Consent, name: string, kind?: "preview"): Promise<VariableKind[]> {
    VariableService.assertName(name);
    const scope =
      kind === undefined ? { project_id: this.projectId } : { project_id: this.projectId, kind };
    await consent.unlock(this.client).deleteVariable(name, scope);
    return VariableService.kindsRemoved(kind);
  }

  /**
   * Whether the name's primary value is a secret. A token that may not read the
   * primary values leaves the answer to whoever can, so it reads as no; any other
   * failure leaves it unknown and is thrown, because acting on an unknown is the
   * one outcome a caller asking this exists to prevent.
   */
  async holdsSecret(name: string): Promise<boolean> {
    try {
      const held = (await this.read("primary"))[name]?.primary;
      return typeof held === "object" && held !== null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Which names hold a value in the given kind, and whether each is a secret.
   *
   * @returns The names mapped to whether they are secret, or undefined when a
   * token that may not read the preview values asked for them, which leaves the
   * check to whoever can.
   */
  async heldByName(kind: VariableKind): Promise<ReadonlyMap<string, boolean> | undefined> {
    try {
      const held = await this.read(kind);
      return new Map(
        Object.entries(valuesOfKind(held, kind)).map(([name, value]) => [
          name,
          typeof value === "object",
        ]),
      );
    } catch (error) {
      if (kind === "preview" && error instanceof ApiError && error.status === 403) {
        return undefined;
      }
      throw error;
    }
  }

  private async read(kind: VariableKind): Promise<GetVariables200> {
    return this.client.getVariables({ project_id: this.projectId, kind });
  }
}
