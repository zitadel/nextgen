import type { Parsed } from "@zitadel/config/idp";

import type { Held, Scalar, Variable } from "@/lib/backend";

/** Stands in for a secret's value, which the platform never discloses. */
const SECRET_MARKER = "(secret)";

/** Stands in for a kind the name holds no value for at all. */
const NO_VALUE = "-";

/**
 * A JSON number, spelled strictly. `Number()` alone would accept `0x10`, a
 * blank string, or surrounding whitespace, none of which is a number anyone
 * means when they type one.
 */
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** The scalar types a variable can hold, as {@link VariableView.TYPES} lists them. */
const VARIABLE_TYPES = ["string", "number", "boolean"] as const;

/** One of the scalar types a variable can hold. */
export type VariableType = (typeof VARIABLE_TYPES)[number];

/**
 * How a variable is shown and how a typed value for one is read: the cells a
 * table prints, where a secret shows its marker, and the scalar a user's text
 * stands for.
 */
export class VariableView {
  /**
   * The scalar types a variable can hold — the API's JSON scalars (ADR 062 §1).
   * The server resolves `${{ NAME }}` only in an OIDC connection's `client_id`
   * and `client_secret` (`flow_sso_redirect_issuer.go`, `flow_sso_callback.go`),
   * and both must hold a string, so no reference resolves to a number or
   * boolean yet.
   */
  static readonly TYPES: readonly VariableType[] = VARIABLE_TYPES;

  /** The variable shown. */
  private readonly variable: Variable;

  /**
   * @param variable - The variable to show.
   */
  private constructor(variable: Variable) {
    this.variable = variable;
  }

  /**
   * The view of a variable.
   *
   * @param variable - The variable to show.
   * @returns Its view.
   */
  static of(variable: Variable): VariableView {
    return new VariableView(variable);
  }

  /**
   * One kind's value as a single cell: the value, or the secret marker. An
   * empty string shows as a pair of quotes, so it is not mistaken for nothing
   * at all.
   *
   * @param held - What the kind holds.
   * @returns The cell's text.
   */
  static held(held: Held): string {
    const text = VariableView.shown(held);
    return text === "" ? '""' : text;
  }

  /**
   * Turn what was typed or piped into the scalar to store, as the type asks,
   * or say what is wrong with it. The problem carries its hint, so a caller
   * that only has the problem to show loses nothing.
   *
   * The type is stated, never guessed: an integer past 2^53 has no exact JSON
   * number, so an ID or a numeric credential would be stored with different
   * digits than were entered. It is refused rather than silently rounded.
   *
   * @param raw - The text as given.
   * @param type - The type it must be.
   * @returns The scalar, or the problem with the text.
   */
  static parse(raw: string, type: VariableType): Parsed<string | number | boolean> {
    switch (type) {
      case "string":
        return { ok: true, value: raw };
      case "boolean":
        if (raw === "true" || raw === "false") {
          return { ok: true, value: raw === "true" };
        }
        return VariableView.refuse(
          `Expected true or false, got ${JSON.stringify(raw)}.`,
          "A boolean variable is exactly true or false.",
        );
      case "number": {
        const value = Number(raw);
        if (!JSON_NUMBER.test(raw) || !Number.isFinite(value)) {
          return VariableView.refuse(
            `Expected a number, got ${JSON.stringify(raw)}.`,
            "Write it as a JSON number, such as 5, -1.5 or 1e3.",
          );
        }
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          return VariableView.refuse(
            `${raw} is too large to store exactly as a number.`,
            "Store it as a string, which keeps every digit.",
          );
        }
        return { ok: true, value };
      }
    }
  }

  /**
   * The cells of a table with one value column, where a secret shows its marker.
   *
   * @returns The name and the value, ready to print.
   */
  cell(): { name: string; value: string } {
    return {
      name: this.variable.name,
      value: this.variable.secret ? SECRET_MARKER : VariableView.render(this.variable.value),
    };
  }

  /**
   * The cells of a table with a preview column beside the value, as the
   * project's own set of variables is listed.
   *
   * @returns The name, the primary value and the preview value, ready to print.
   */
  inventoryCell(): { name: string; value: string; preview: string } {
    const { variable } = this;
    return {
      name: variable.name,
      value: VariableView.shown(
        variable.value === undefined && !variable.secret ? undefined : variable,
      ),
      preview: VariableView.shown(variable.preview),
    };
  }

  /**
   * A stored scalar as text. It is the value the server holds, unescaped: the
   * render boundary escapes what it prints, so what a caller stores or
   * compares is the real value.
   *
   * @param value - The scalar, or undefined.
   * @returns The value as text.
   */
  private static render(value: Scalar | undefined): string {
    return typeof value === "string" ? value : String(value);
  }

  /**
   * What one kind of a name shows: its value, the secret marker, or `-` when
   * the name holds nothing for that kind, because an empty cell would read as
   * an empty value.
   *
   * @param held - What the kind holds, or undefined when it holds nothing.
   * @returns The cell's text.
   */
  private static shown(held: Held | undefined): string {
    if (held === undefined) {
      return NO_VALUE;
    }
    if (held.secret) {
      return SECRET_MARKER;
    }
    return held.value === undefined ? NO_VALUE : VariableView.render(held.value);
  }

  /**
   * A refusal that names what was wrong and how to fix it.
   *
   * @param problem - What was wrong.
   * @param hint - How to fix it.
   * @returns The failed parse.
   */
  private static refuse(problem: string, hint: string): Parsed<never> {
    return { ok: false, problem: `${problem} ${hint}` };
  }
}
