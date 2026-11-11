import type { GetVariable200, GetVariables200 } from "@zitadel/api/generated/model";
import { isCancelled, type ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";
import { ForbiddenError, NotFoundError } from "@/lib/backend/errors";

/** The kinds of value a name can hold: what primary deploys freeze, and what preview deploys freeze. */
export type VariableKind = "primary" | "preview";

/** One value as the API reports it: a bare scalar, or `{"secret": true}` for a secret. */
export type VariableValue = NonNullable<GetVariable200["primary"]>;

/** The scalar a plain variable holds. */
export type Scalar = string | number | boolean;

/** What one kind of a name holds: a value, or the fact that a secret is held. */
export type Held = Readonly<{
  secret: boolean;
  value?: Scalar;
}>;

/** What a name holds in each kind, as a write leaves it. */
export type VariableState = Readonly<Record<VariableKind, Variable | undefined>>;

/**
 * What reading one kind back after a write came to: the value the name holds in
 * it, or the failure that left it unknown.
 */
type KindRead = Readonly<
  {
    kind: VariableKind;
  } & (
    | {
        read: true;
        variable: Variable | undefined;
      }
    | {
        read: false;
        cause: unknown;
      }
  )
>;

/**
 * A kind whose state could not be read back, and why.
 *
 * The write had already returned when the read failed, so this never means the
 * value was not stored. It means only that what the name now holds in that kind
 * is unknown, which is a different thing from holding nothing.
 */
export type UnverifiedKind = Readonly<{
  kind: VariableKind;
  cause: unknown;
}>;

/**
 * What a write came to.
 *
 * `needs-secret-preview` is the one refusal the platform's rule carries: a name
 * whose primary value is a secret holds a credential, so its preview value is
 * one too, and stored plain it would be readable and a preview deploy would
 * freeze it in the clear. Nothing was written in that case.
 *
 * A kind named in `unverified` has no fact in `state`: the write stored what it
 * was given, and only the report of what the name holds afterwards is missing.
 */
export type VariableWritten = Readonly<
  {
    name: string;
  } & (
    | {
        outcome: "set";
        state: VariableState;
        unverified: readonly UnverifiedKind[];
      }
    | {
        outcome: "needs-secret-preview";
      }
  )
>;

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
function valuesOfKind(
  body: GetVariables200,
  kind: VariableKind,
): Readonly<Record<string, VariableValue>> {
  return Object.fromEntries(
    Object.entries(body).flatMap(([name, byKind]) => {
      return byKind[kind] === undefined ? [] : [[name, byKind[kind]]];
    }),
  );
}

function heldOf(value: VariableValue): Held {
  return typeof value === "object" && value !== null
    ? {
        secret: true,
      }
    : {
        secret: false,
        value,
      };
}

/**
 * How a value is entered on a project: whether it is a secret, and whether it
 * is the preview value alone.
 *
 * @remarks
 * A Value Object (Fowler, PoEAA): immutable, and it owns the platform's rule
 * for which kinds a write sets, so neither a command nor the service decides it
 * again. It carries no value, because a command settles how it writes before it
 * has one to write: a dry run states the kinds it would set without ever asking
 * for the value, which for a secret it must not do.
 */
export class VariableWrite {
  readonly secret: boolean;
  readonly preview: boolean;

  /**
   * Build a write from how the value is entered.
   *
   * @param record - Whether the value is a secret, and whether it is the preview value alone.
   */
  private constructor(record: {
    secret: boolean;
    preview: boolean;
  }) {
    this.secret = record.secret;
    this.preview = record.preview;
  }

  /**
   * How a value is entered on the project.
   *
   * @param record - Whether the value is a secret, and whether it is the preview value alone.
   * @returns The write.
   */
  static of(record: { secret: boolean; preview: boolean }): VariableWrite {
    return new VariableWrite(record);
  }

  /**
   * The kinds this write sets, as the platform's rule gives them: the preview
   * kind alone for a preview write, otherwise both kinds for a plain value and
   * the primary kind alone for a secret, which the platform never mirrors into
   * a preview.
   *
   * @returns The kinds the write sets.
   */
  get kinds(): readonly VariableKind[] {
    if (this.preview) {
      return ["preview"];
    }
    return this.secret ? ["primary"] : ["primary", "preview"];
  }
}

/**
 * A withdrawal of a name, and how much of it goes.
 *
 * @remarks
 * A Value Object (Fowler, PoEAA): immutable, and the counterpart to
 * {@link VariableWrite}, owning the rule for which kinds a removal clears.
 */
export class VariableRemoval {
  readonly preview: boolean;

  /**
   * Build a removal from how much of the name goes.
   *
   * @param record - Whether the preview value alone is removed.
   */
  private constructor(record: {
    preview: boolean;
  }) {
    this.preview = record.preview;
  }

  /**
   * A withdrawal of a name.
   *
   * @param record - Whether the preview value alone is removed.
   * @returns The removal.
   */
  static of(record: { preview: boolean }): VariableRemoval {
    return new VariableRemoval(record);
  }

  /**
   * The kinds this removal clears: the preview value alone, or both.
   *
   * @returns The kinds the removal clears.
   */
  get kinds(): readonly VariableKind[] {
    return this.preview ? ["preview"] : ["primary", "preview"];
  }
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

  /**
   * Build a variable from what each kind holds.
   *
   * @param name - The variable's name.
   * @param primary - What the primary kind holds, when it holds anything.
   * @param preview - What the preview kind holds, when it holds anything.
   */
  private constructor(name: string, primary: Held | undefined, preview: Held | undefined) {
    this.name = name;
    this.secret = primary?.secret ?? false;
    if (primary?.value !== undefined) {
      this.value = primary.value;
    }
    if (preview !== undefined) {
      this.preview = preview;
    }
  }

  /**
   * One name with the value it holds in a single kind.
   *
   * @param name - The variable's name.
   * @param value - The value as the platform reports it.
   * @returns The variable.
   */
  static of(name: string, value: VariableValue): Variable {
    return new Variable(name, heldOf(value), undefined);
  }

  /**
   * The values of one kind as variables.
   *
   * @param values - The values, keyed by name.
   * @returns The variables, sorted by name so output is stable between runs.
   */
  static fromValues(values: Readonly<Record<string, VariableValue>>): readonly Variable[] {
    return Object.entries(values)
      .map(([name, value]) => {
        return Variable.of(name, value);
      })
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Every name on the project with the primary value it holds and the preview
   * value beside it. A name is listed when either kind holds a value, so a
   * preview-only name does not disappear.
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
   * The plain record the JSON output carries.
   *
   * @returns The name, whether it is a secret, and the values it holds.
   */
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
 * Its endpoint does not page, and it has no `list`: the two views of a
 * project's variables answer different questions, so each is named for the one
 * it answers rather than hidden behind a flag on a single read.
 */
export class VariableService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and the project every call concerns.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project every call concerns.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /** The longest name the platform accepts, for a caller that says so itself. */
  static readonly nameMaxLength = NAME_MAX_LENGTH;

  /**
   * What the platform would refuse about a name, if anything. The grammar lives
   * here, beside the values it names, so a command that refuses the name before
   * it asks anything reads the same rule the write is checked against.
   *
   * @param name - The name to check.
   * @returns Why the platform would refuse it, or undefined when it would not.
   */
  static nameProblem(name: string): "invalid" | "too-long" | undefined {
    if (!NAME_PATTERN.test(name)) {
      return "invalid";
    }
    return name.length > NAME_MAX_LENGTH ? "too-long" : undefined;
  }

  /**
   * Every name on the project, with its primary value and the preview value
   * beside it. A name that holds only a preview value is listed too, so it does
   * not disappear from the project's own set.
   *
   * @returns The variables, sorted by name.
   */
  async inventory(): Promise<readonly Variable[]> {
    return Variable.inventory(
      await this.client.getVariables({
        project_id: this.projectId,
      }),
    );
  }

  /**
   * The names that hold a preview value, with that value. The preview values
   * stand alone: the platform never merges them with the primary ones.
   *
   * @returns The variables, sorted by name.
   */
  async previews(): Promise<readonly Variable[]> {
    return Variable.fromValues(valuesOfKind(await this.read("preview"), "preview"));
  }

  /**
   * Read one variable in the given kind.
   *
   * @param name - The variable to read.
   * @param kind - The kind to read it in.
   * @returns The variable. A secret is found but not disclosed.
   * @throws NotFoundError when the name holds no value of that kind.
   */
  async get(name: string, kind: VariableKind): Promise<Variable> {
    const response = await this.client.getVariable(name, {
      project_id: this.projectId,
      kind,
    });
    const value = response[kind];
    if (value === undefined) {
      throw new NotFoundError(`Variable ${name} has no ${kind} value.`, {
        hint:
          kind === "preview"
            ? "A name has a preview value only once one is set with `--preview`."
            : "Set one with `variable set`.",
      });
    }
    return Variable.of(name, value);
  }

  /**
   * Find which names hold a value in the given kind, and whether each is a secret.
   *
   * @param kind - The kind to read.
   * @returns The names mapped to whether they are secret.
   * @throws ForbiddenError `403` for a token that may not read the values of that kind.
   */
  async heldByName(kind: VariableKind): Promise<ReadonlyMap<string, boolean>> {
    const held = await this.read(kind);
    const entries = Object.entries(valuesOfKind(held, kind));
    return new Map(
      entries.map(([name, value]) => {
        // Asked of the variable rather than of the value, so the one answer to
        // what counts as a secret is the one the rest of the file gives.
        return [name, Variable.of(name, value).secret];
      }),
    );
  }

  /**
   * Set one name to a value, in the kinds the write sets.
   *
   * A plain preview value is refused for a name whose primary value is a
   * secret, rather than written, because the preview value of a credential is a
   * credential too.
   *
   * @param name - The variable to set.
   * @param value - The value to store.
   * @param write - How it is entered: as a secret, as the preview value alone.
   * @returns What the name holds in each kind afterwards, or the refusal. The
   * write answers with the kinds it touched, and the kind it did not touch is
   * read separately, because the platform never merges the two kinds in one
   * answer.
   */
  async set(name: string, value: Scalar, write: VariableWrite): Promise<VariableWritten> {
    if (write.preview && !write.secret && (await this.secretHeldAsPrimary(name))) {
      return {
        name,
        outcome: "needs-secret-preview",
      };
    }
    const written =
      (
        await this.client.updateVariables(
          {
            [name]: {
              value,
              secret: write.secret,
            },
          },
          this.scopeOf(write.preview),
        )
      )[name] ?? {};
    // Together: a write the answer did not name the kind of is read back, and
    // the two kinds are read from different calls, so asking in turn would cost
    // a whole round trip for nothing.
    const [primary, preview] = await Promise.all([
      this.writtenState(name, written, "primary"),
      this.writtenState(name, written, "preview"),
    ]);
    return {
      name,
      outcome: "set",
      state: {
        primary: primary.read ? primary.variable : undefined,
        preview: preview.read ? preview.variable : undefined,
      },
      unverified: [primary, preview].flatMap((read) => {
        return read.read
          ? []
          : [
              {
                kind: read.kind,
                cause: read.cause,
              },
            ];
      }),
    };
  }

  /**
   * Remove one name, in the kinds the removal clears.
   *
   * @param name - The variable to remove.
   * @param removal - How much of the name goes.
   */
  async remove(name: string, removal: VariableRemoval): Promise<void> {
    await this.client.deleteVariable(name, this.scopeOf(removal.preview));
  }

  /**
   * What a name holds in one kind once a write has returned.
   *
   * The write answers with the kinds it touched, so a kind it named needs no
   * read. A kind it did not name is read, and that read is only the report: the
   * value is already stored, so a failure here leaves what the name holds
   * unknown rather than meaning the write did not happen. It is answered as
   * unread instead of thrown, because throwing would tell a caller its write
   * failed when it succeeded, and answered as unread rather than as holding
   * nothing, because a kind nobody could look at is not an empty one.
   *
   * @param name - The variable that was written.
   * @param written - The kinds the write answered with.
   * @param kind - The kind to report.
   * @returns The value the name holds in that kind, or why it is unknown.
   */
  private async writtenState(
    name: string,
    written: Readonly<Partial<Record<VariableKind, VariableValue>>>,
    kind: VariableKind,
  ): Promise<KindRead> {
    const answered = written[kind];
    if (answered !== undefined) {
      return {
        kind,
        read: true,
        variable: Variable.of(name, answered),
      };
    }
    try {
      const held = (await this.read(kind))[name]?.[kind];
      return {
        kind,
        read: true,
        variable: held === undefined ? undefined : Variable.of(name, held),
      };
    } catch (cause) {
      // A cancellation is not a kind that could not be read: the person asked
      // the command to stop, so it stops rather than reporting what it found.
      if (isCancelled(this.client)) {
        throw cause;
      }
      return {
        kind,
        read: false,
        cause,
      };
    }
  }

  /**
   * Read the raw values of one kind.
   *
   * @param kind - Which values to read.
   * @returns The values and the secrets named without disclosure.
   */
  private async read(kind: VariableKind): Promise<GetVariables200> {
    return this.client.getVariables({
      project_id: this.projectId,
      kind,
    });
  }

  /**
   * Whether the name's primary value is a secret.
   *
   * A token that may not read the primary values answers `403`, which leaves
   * the check to whoever can read them: a write refused here would be refused
   * for a credential nobody could confirm. A name the project has not entered
   * holds no secret.
   *
   * @param name - The variable to check.
   * @returns True when the name's primary value is a secret.
   */
  private async secretHeldAsPrimary(name: string): Promise<boolean> {
    const held = await this.client
      .getVariable(name, {
        project_id: this.projectId,
        kind: "primary",
      })
      .catch((error: unknown): GetVariable200 => {
        if (error instanceof NotFoundError || error instanceof ForbiddenError) {
          return {};
        }
        throw error;
      });
    return typeof held.primary === "object" && held.primary !== null;
  }

  /**
   * The scope one call carries: the project, and the preview kind when the
   * write or removal concerns that kind alone.
   *
   * @param preview - Whether the call concerns the preview kind alone.
   * @returns The scope.
   */
  private scopeOf(preview: boolean): {
    project_id: string;
    kind?: VariableKind;
  } {
    if (preview) {
      return {
        project_id: this.projectId,
        kind: "preview",
      };
    }
    return {
      project_id: this.projectId,
    };
  }
}
