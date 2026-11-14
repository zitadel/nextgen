import { describe, expect, it } from "vitest";

import { EndStep, Wizard, WizardDefinitionError, WizardStep } from "@/lib/wizard";

/**
 * What every run starts from.
 */
type Initial = { readonly input: string };

/**
 * Where the steps in these tests write as they run and as they are undone, so
 * the order of both can be read back.
 */
type Log = string[];

/**
 * Adds a fact, and says in the log when it ran and when it was undone.
 */
class Adds<Key extends string, Value> extends WizardStep<
  Key,
  { readonly [K in Key]: Value },
  Initial
> {
  readonly key: Key;

  private readonly value: Value;

  private readonly log: Log;

  constructor(log: Log, key: Key, value: Value) {
    super();
    this.log = log;
    this.key = key;
    this.value = value;
  }

  async run(): Promise<{ readonly [K in Key]: Value }> {
    this.log.push(`run ${this.key}`);
    return { [this.key]: this.value } as { readonly [K in Key]: Value };
  }

  override async undo(): Promise<void> {
    this.log.push(`undo ${this.key}`);
  }
}

/**
 * Fails when it runs.
 */
class Fails extends WizardStep<"fails", { readonly never: true }, Initial> {
  readonly key = "fails";

  async run(): Promise<{ readonly never: true }> {
    throw new Error("boom");
  }
}

/**
 * Finishes, and fails when it is undone.
 */
class UndoFails extends WizardStep<"undoFails", { readonly a: true }, Initial> {
  readonly key = "undoFails";

  async run(): Promise<{ readonly a: true }> {
    return { a: true };
  }

  override async undo(): Promise<void> {
    throw new Error("could not undo");
  }
}

/**
 * Throws what an aborted run throws.
 */
class Aborted extends WizardStep<"aborted", { readonly b: true }, Initial> {
  readonly key = "aborted";

  async run(): Promise<{ readonly b: true }> {
    throw new DOMException("interrupted", "AbortError");
  }
}

/**
 * Reads what an earlier step added.
 */
class Reads extends WizardStep<"reads", { readonly seen: string }, { readonly first: number }> {
  readonly key = "reads";

  async run(needs: { readonly first: number }): Promise<{ readonly seen: string }> {
    return { seen: `first is ${needs.first}` };
  }
}

/**
 * Ends the wizard when told to.
 */
class EndsWhen extends EndStep<"ends", string, Initial> {
  readonly key = "ends";

  private readonly applies: boolean;

  constructor(applies: boolean) {
    super();
    this.applies = applies;
  }

  when(): boolean {
    return this.applies;
  }

  async run(needs: Initial): Promise<string> {
    return `ended on ${needs.input}`;
  }
}

/**
 * A wizard that answers with a string.
 */
function started(): Wizard<Initial, Initial, string> {
  return Wizard.named<Initial, string>("test");
}

describe("Wizard", () => {
  describe("running the steps", () => {
    it("runs them in the order they were added", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new Adds(log, "second", 2))
        .finish(() => "done");

      await wizard.run({ input: "x" });

      expect(log).toEqual(["run first", "run second"]);
    });

    it("hands each step what the steps before it added", async () => {
      const wizard = started()
        .step(new Adds([], "first", 1))
        .step(new Reads())
        .finish((state) => state.seen);

      const answer = await wizard.run({ input: "x" });

      expect(answer).toBe("first is 1");
    });

    it("answers with what the finish step builds from everything settled", async () => {
      const wizard = started()
        .step(new Adds([], "first", 1))
        .step(new Adds([], "second", 2))
        .finish((state) => `${state.input} ${state.first} ${state.second}`);

      const answer = await wizard.run({ input: "x" });

      expect(answer).toBe("x 1 2");
    });

    it("leaves the wizard it extended as it was", async () => {
      const log: Log = [];
      const base = started();
      const extended = base.step(new Adds(log, "first", 1));

      await base.finish(() => "base").run({ input: "x" });
      await extended.finish(() => "extended").run({ input: "x" });

      expect(log).toEqual(["run first"]);
    });
  });

  describe("naming a step twice", () => {
    it("refuses the second one", () => {
      const build = (): unknown => {
        return started()
          .step(new Adds([], "first", 1))
          .step(new Adds([], "first", 2));
      };

      expect(build).toThrow(WizardDefinitionError);
    });

    it("names the wizard and the step in the refusal", () => {
      const build = (): unknown => {
        return started()
          .step(new Adds([], "first", 1))
          .step(new Adds([], "first", 2));
      };

      expect(build).toThrow('The wizard "test" already has a step "first"');
    });
  });

  describe("a step that needs what no step before it adds", () => {
    it("does not compile", () => {
      // @ts-expect-error `Reads` needs `first`, which nothing before it adds.
      const wizard = started().step(new Reads());

      expect(wizard).toBeInstanceOf(Wizard);
    });
  });

  describe("observing a step", () => {
    it("tells the observer what is known, with what the step added", async () => {
      const seen: string[] = [];
      const wizard = started()
        .step(new Adds([], "first", 1))
        .step(new Adds([], "second", 2), (state) => {
          seen.push(`${state.input} ${state.first} ${state.second}`);
        })
        .finish(() => "done");

      await wizard.run({ input: "x" });

      expect(seen).toEqual(["x 1 2"]);
    });

    it("tells it right after its own step, before the next one runs", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1), () => log.push("saw first"))
        .step(new Adds(log, "second", 2), () => log.push("saw second"))
        .finish(() => "done");

      await wizard.run({ input: "x" });

      expect(log).toEqual(["run first", "saw first", "run second", "saw second"]);
    });

    it("does not tell it of a step that failed", async () => {
      const seen: string[] = [];
      const wizard = started()
        .step(new Fails(), () => seen.push("fails"))
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(seen).toEqual([]);
    });

    it("does not tell it of a step that was undone before its turn", async () => {
      const seen: string[] = [];
      const wizard = started()
        .step(new Fails())
        .step(new Adds([], "later", 1), () => seen.push("later"))
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(seen).toEqual([]);
    });

    it("undoes the step, and those before it, when the observer throws", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new Adds(log, "second", 2), () => {
          throw new Error("observer");
        })
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "run second", "undo second", "undo first"]);
    });

    it("throws what the observer threw", async () => {
      const wizard = started()
        .step(new Adds([], "first", 1), () => {
          throw new Error("observer");
        })
        .finish(() => "done");

      const run = wizard.run({ input: "x" });

      await expect(run).rejects.toThrow("observer");
    });
  });

  describe("when a step fails", () => {
    it("throws the error that stopped the run", async () => {
      const wizard = started()
        .step(new Adds([], "first", 1))
        .step(new Fails())
        .finish(() => "done");

      const run = wizard.run({ input: "x" });

      await expect(run).rejects.toThrow("boom");
    });

    it("undoes the steps that finished, newest first", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new Adds(log, "second", 2))
        .step(new Fails())
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "run second", "undo second", "undo first"]);
    });

    it("does not undo the step that failed, which never finished", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Fails())
        .step(new Adds(log, "later", 1))
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual([]);
    });

    it("keeps undoing when one undo fails, and says which", async () => {
      const log: Log = [];
      const undoErrors: string[] = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new UndoFails())
        .step(new Fails())
        .finish(() => "done");

      await wizard
        .run({ input: "x" }, { onUndoError: (key) => undoErrors.push(key) })
        .catch(() => undefined);

      expect({ log, undoErrors }).toEqual({
        log: ["run first", "undo first"],
        undoErrors: ["undoFails"],
      });
    });

    it("undoes the steps that finished when the answer cannot be built", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .finish(() => {
          throw new Error("no answer");
        });

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "undo first"]);
    });
  });

  describe("when a step throws because the run was aborted", () => {
    it("undoes what finished, newest first", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new Adds(log, "second", 2))
        .step(new Aborted())
        .step(new Adds(log, "later", 3))
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "run second", "undo second", "undo first"]);
    });
  });

  describe("the point of no return", () => {
    it("keeps the steps before it when a later step fails", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .commit()
        .step(new Adds(log, "second", 2))
        .step(new Fails())
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "run second", "undo second"]);
    });

    it("still undoes the steps before it when a step before it fails", async () => {
      const log: Log = [];
      const wizard = started()
        .step(new Adds(log, "first", 1))
        .step(new Fails())
        .commit()
        .finish(() => "done");

      await wizard.run({ input: "x" }).catch(() => undefined);

      expect(log).toEqual(["run first", "undo first"]);
    });
  });

  describe("a step that ends the wizard", () => {
    it("answers with its result and runs nothing after it", async () => {
      const log: Log = [];
      const wizard = started()
        .endWhen(new EndsWhen(true))
        .step(new Adds(log, "first", 1))
        .finish(() => "finished normally");

      const answer = await wizard.run({ input: "x" });

      expect({ answer, log }).toEqual({ answer: "ended on x", log: [] });
    });

    it("lets the wizard go on when it does not apply", async () => {
      const wizard = started()
        .endWhen(new EndsWhen(false))
        .step(new Adds([], "first", 1))
        .finish(() => "finished normally");

      const answer = await wizard.run({ input: "x" });

      expect(answer).toBe("finished normally");
    });
  });
});
