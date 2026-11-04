import type { GetVariable200, GetVariables200 } from "@zitadel/api/generated/model";

import { escapeControlCharacters, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { ZitadelError } from "../errors";

/** The kinds of value a name can hold: what primary deploys freeze, and what preview deploys freeze. */
export type VariableKind = "primary" | "preview";

/** One value on the wire: a bare scalar, or `{"secret": true}` for a secret. */
export type VariableValue = NonNullable<GetVariable200["primary"]>;

/** The scalar a plain variable holds. */
type Scalar = string | number | boolean;

/** What one kind of a name holds: a value, or the fact that a secret is held. */
type Held = Readonly<{
  secret: boolean;
  value?: Scalar;
}>;

/** What a name holds in each kind, as a write leaves it. */
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

/**
 * The values of one kind in a read, keyed by name.
 *
 * @param body - What a read answered.
 * @param kind - The kind to keep.
 * @returns The names that hold a value of that kind, with the value.
 */
export function valuesOfKind(
  body: GetVariables200,
  kind: VariableKind,
): Readonly<Record<string, VariableValue>> {
  return Object.fromEntries(
    Object.entries(body).flatMap(([name, byKind]) => {
      return byKind[kind] === undefined ? [] : [[name, byKind[kind]]];
    }),
  );
}

function heldOf(wire: VariableValue): Held {
  return typeof wire === "object" && wire !== null
    ? {
        secret: true,
      }
    : {
        secret: false,
        value: wire,
      };
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
    ? escapeControlCharacters(value, {
        keepLayout: false,
      })
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

  /**
   * One name with the value it holds in a single kind.
   *
   * @param name - The variable's name.
   * @param wire - The value as the platform reports it.
   * @returns The variable.
   */
  static of(name: string, wire: VariableValue): Variable {
    return new Variable(name, heldOf(wire), undefined);
  }

  /**
   * The values of one kind as variables.
   *
   * @param values - The values, keyed by name.
   * @returns The variables, sorted by name so output is stable between runs.
   */
  static fromValues(values: Readonly<Record<string, VariableValue>>): readonly Variable[] {
    return Object.entries(values)
      .map(([name, wire]) => {
        return Variable.of(name, wire);
      })
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Every name on the project with the primary value it holds and the preview
   * value beside it. A name is listed when either kind holds a value, so a
   * preview-only name does not disappear (#1617).
   *
   * @param body - What a read without a kind answered.
   * @returns The variables, sorted by name.
   */
  static inventory(body: GetVariables200): readonly Variable[] {
    return Object.entries(body)
      .map(([name, byKind]) => {
        const primary = byKind.primary === undefined ? undefined : heldOf(byKind.primary);
        const preview = byKind.preview === undefined ? undefined : heldOf(byKind.preview);
        return new Variable(name, primary, preview);
      })
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * The cells of a table with one value column. Every value is escaped for the
   * terminal, and a secret prints a marker.
   */
  cell(): {
    name: string;
    value: string;
  } {
    return {
      name: this.name,
      value: this.secret ? SECRET_MARKER : render(this.value),
    };
  }

  /**
   * The cells of a table with a preview column beside the value. A kind the
   * name holds nothing for prints `-`, because an empty cell would read as an
   * empty value.
   */
  inventoryCell(): {
    name: string;
    value: string;
    preview: string;
  } {
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

  /** The plain record the JSON output carries. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      secret: this.secret,
      ...(this.value === undefined
        ? {}
        : {
            value: this.value,
          }),
      ...(this.preview === undefined
        ? {}
        : {
            preview: this.preview,
          }),
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
   * @param name - The name to check.
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
        {
          hint: "Shorten the name.",
        },
      );
    }
  }

  /**
   * The kinds a write sets: the platform's rule for where a plain value and a
   * secret go.
   *
   * @param secret - Whether the value is a secret.
   * @param kind - `preview` to write the preview kind alone.
   * @returns The kinds the write sets.
   */
  static kindsWritten(secret: boolean, kind?: "preview"): readonly VariableKind[] {
    if (kind === "preview") {
      return ["preview"];
    }
    return secret ? ["primary"] : ["primary", "preview"];
  }

  /**
   * The kinds a removal clears: the preview value alone, or both.
   *
   * @param kind - `preview` to remove the preview kind alone.
   * @returns The kinds the removal clears.
   */
  static kindsRemoved(kind?: "preview"): readonly VariableKind[] {
    return kind === "preview" ? ["preview"] : ["primary", "preview"];
  }

  /**
   * List the variables of the project.
   *
   * @param kind - Without a kind, every name with its primary value and the
   * preview value beside it; with one, only the names that hold a value of it.
   * @returns The variables, sorted by name.
   */
  async list(kind?: VariableKind): Promise<readonly Variable[]> {
    if (kind === undefined) {
      return Variable.inventory(
        await this.client.getVariables({
          project_id: this.projectId,
        }),
      );
    }
    return Variable.fromValues(valuesOfKind(await this.read(kind), kind));
  }

  /**
   * Read one variable in the given kind.
   *
   * @param name - The variable to read.
   * @param kind - The kind to read it in.
   * @returns The variable. A secret is found but not disclosed.
   * @throws ZitadelError `E_VALIDATION` for a name the platform would refuse.
   * @throws ZitadelError `E_NOT_FOUND` when the name holds no value of that kind.
   */
  async get(name: string, kind: VariableKind): Promise<Variable> {
    VariableService.assertName(name);
    const held = await this.client.getVariable(name, {
      project_id: this.projectId,
      kind,
    });
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
   * @param name - The variable to set.
   * @param write - The value, and whether it is a secret.
   * @param kind - `preview` to write the preview kind alone.
   * @returns What the name holds in each kind afterwards. The write answers with
   * the kinds it touched, and the kind it did not touch is read separately,
   * because the platform never merges the two kinds in one answer.
   * @throws ZitadelError `E_VALIDATION` for a name the platform would refuse.
   */
  async set(
    name: string,
    write: Readonly<{ value: Scalar; secret: boolean }>,
    kind?: "preview",
  ): Promise<VariableState> {
    VariableService.assertName(name);
    const scope =
      kind === undefined
        ? {
            project_id: this.projectId,
          }
        : {
            project_id: this.projectId,
            kind,
          };
    const written =
      (
        await this.client.updateVariables(
          {
            [name]: write,
          },
          scope,
        )
      )[name] ?? {};
    const stateOf = async (of: VariableKind): Promise<Variable | undefined> => {
      const wire = written[of] ?? (await this.read(of))[name]?.[of];
      return wire === undefined ? undefined : Variable.of(name, wire);
    };
    return Object.freeze({
      primary: await stateOf("primary"),
      preview: await stateOf("preview"),
    });
  }

  /**
   * Remove one name: its preview value alone, or both kinds.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param name - The variable to remove.
   * @param kind - `preview` to remove the preview kind alone.
   * @returns The kinds cleared.
   * @throws ZitadelError `E_VALIDATION` for a name the platform would refuse.
   */
  async remove(consent: Consent, name: string, kind?: "preview"): Promise<readonly VariableKind[]> {
    VariableService.assertName(name);
    const scope =
      kind === undefined
        ? {
            project_id: this.projectId,
          }
        : {
            project_id: this.projectId,
            kind,
          };
    await consent.unlock(this.client).deleteVariable(name, scope);
    return VariableService.kindsRemoved(kind);
  }

  /**
   * Find which names hold a value in the given kind, and whether each is a secret.
   *
   * @param kind - The kind to read.
   * @returns The names mapped to whether they are secret.
   * @throws ApiError `403` for a token that may not read the values of that kind.
   */
  async heldByName(kind: VariableKind): Promise<ReadonlyMap<string, boolean>> {
    const held = await this.read(kind);
    const entries = Object.entries(valuesOfKind(held, kind));
    return new Map(
      entries.map(([name, value]) => {
        return [name, typeof value === "object"];
      }),
    );
  }

  /**
   * Whether the name's primary value is a secret.
   *
   * @param name - The variable to check.
   * @returns True when the primary value is a secret.
   * @throws ApiError `403` for a token that may not read the primary values.
   */
  async holdsSecret(name: string): Promise<boolean> {
    const held = (await this.read("primary"))[name]?.primary;
    return typeof held === "object" && held !== null;
  }

  private async read(kind: VariableKind): Promise<GetVariables200> {
    return this.client.getVariables({
      project_id: this.projectId,
      kind,
    });
  }
}
