import { describe, expect, it } from "vitest";

import { EndStep, type StepEvent, Wizard, WizardDefinitionError, WizardStep } from "@/lib/wizard";

/**
 * What the steps in these tests share: a log they write to as they run and as
 * they are undone, so the order of both can be read back.
 */
type Services = { readonly log: string[] };

/**
 * What every run starts from.
 */
type Initial = { readonly input: string };

/**
 * Adds a fact, and says in the log when it ran and when it was undone.
 */
class Adds<Key extends string, Value> extends WizardStep<
  Key,
  { readonly [K in Key]: Value },
  Initial,
  Services
> {
  readonly key: Key;

  private readonly value: Value;

  constructor(key: Key, value: Value) {
    super();
    this.key = key;
    this.value = value;
  }

  async run(_needs: Initial, services: Services): Promise<{ readonly [K in Key]: Value }> {
    services.log.push(`run ${this.key}`);
    return { [this.key]: this.value } as { readonly [K in Key]: Value };
  }

  override async undo(
    _out: { readonly [K in Key]: Value },
    _needs: Initial,
    services: Services,
  ): Promise<void> {
    services.log.push(`undo ${this.key}`);
  }
}

/**
 * Fails when it runs.
 */
class Fails extends WizardStep<"fails", { readonly never: true }, Initial, Services> {
  readonly key = "fails";

  async run(): Promise<{ readonly never: true }> {
    throw new Error("boom");
  }
}

/**
 * Reads what an earlier step added.
 */
class Reads extends WizardStep<
  "reads",
  { readonly seen: string },
  { readonly first: number },
  Services
> {
  readonly key = "reads";

  async run(needs: { readonly first: number }): Promise<{ readonly seen: string }> {
    return { seen: `first is ${needs.first}` };
  }
}

/**
 * Ends the wizard when told to.
 */
class EndsWhen extends EndStep<"ends", string, Initial, Services> {
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
 * A wizard that answers with the log of what it settled.
 */
function started(): Wizard<Services, Initial, Initial, string> {
  return Wizard.named<Services, Initial, string>("test");
}

describe("Wizard", () => {
  describe("running the steps", () => {
    it("runs them in the order they were added", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Adds("second", 2))
        .finish(() => "done");

      await wizard.run(services, { input: "x" });

      expect(services.log).toEqual(["run first", "run second"]);
    });

    it("hands each step what the steps before it added", async () => {
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Reads())
        .finish((state) => state.seen);

      const answer = await wizard.run({ log: [] }, { input: "x" });

      expect(answer).toBe("first is 1");
    });

    it("answers with what the finish step builds from everything settled", async () => {
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Adds("second", 2))
        .finish((state) => `${state.input} ${state.first} ${state.second}`);

      const answer = await wizard.run({ log: [] }, { input: "x" });

      expect(answer).toBe("x 1 2");
    });

    it("leaves the wizard it extended as it was", async () => {
      const base = started();
      const extended = base.step(new Adds("first", 1));
      const services: Services = { log: [] };

      await base.finish(() => "base").run(services, { input: "x" });
      await extended.finish(() => "extended").run(services, { input: "x" });

      expect(services.log).toEqual(["run first"]);
    });
  });

  describe("naming a step twice", () => {
    it("refuses the second one", () => {
      const build = (): unknown => {
        return started().step(new Adds("first", 1)).step(new Adds("first", 2));
      };

      expect(build).toThrow(WizardDefinitionError);
    });

    it("names the wizard and the step in the refusal", () => {
      const build = (): unknown => {
        return started().step(new Adds("first", 1)).step(new Adds("first", 2));
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

  describe("when a step fails", () => {
    it("throws the error that stopped the run", async () => {
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Fails())
        .finish(() => "done");

      const run = wizard.run({ log: [] }, { input: "x" });

      await expect(run).rejects.toThrow("boom");
    });

    it("undoes the steps that finished, newest first", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Adds("second", 2))
        .step(new Fails())
        .finish(() => "done");

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual(["run first", "run second", "undo second", "undo first"]);
    });

    it("does not undo the step that failed, which never finished", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Fails())
        .step(new Adds("later", 1))
        .finish(() => "done");

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual([]);
    });

    it("keeps undoing when one undo fails, and says which", async () => {
      class UndoFails extends WizardStep<"undoFails", { readonly a: true }, Initial, Services> {
        readonly key = "undoFails";

        async run(): Promise<{ readonly a: true }> {
          return { a: true };
        }

        override async undo(): Promise<void> {
          throw new Error("could not undo");
        }
      }
      const services: Services = { log: [] };
      const undoErrors: string[] = [];
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new UndoFails())
        .step(new Fails())
        .finish(() => "done");

      await wizard
        .run(services, { input: "x" }, { onUndoError: (key) => undoErrors.push(key) })
        .catch(() => undefined);

      expect({ log: services.log, undoErrors }).toEqual({
        log: ["run first", "undo first"],
        undoErrors: ["undoFails"],
      });
    });

    it("undoes the steps that finished when the answer cannot be built", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("first", 1))
        .finish(() => {
          throw new Error("no answer");
        });

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual(["run first", "undo first"]);
    });
  });

  describe("when the run is aborted", () => {
    it("stops before the next step and undoes what finished", async () => {
      const services: Services = { log: [] };
      const controller = new AbortController();
      class Aborts extends WizardStep<"aborts", { readonly b: true }, Initial, Services> {
        readonly key = "aborts";

        async run(): Promise<{ readonly b: true }> {
          controller.abort(new Error("interrupted"));
          return { b: true };
        }
      }
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Aborts())
        .step(new Adds("later", 2))
        .finish(() => "done");

      await wizard
        .run(services, { input: "x" }, { signal: controller.signal })
        .catch(() => undefined);

      expect(services.log).toEqual(["run first", "undo first"]);
    });
  });

  describe("the point of no return", () => {
    it("keeps the steps before it when a later step fails", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("first", 1))
        .commit()
        .step(new Adds("second", 2))
        .step(new Fails())
        .finish(() => "done");

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual(["run first", "run second", "undo second"]);
    });

    it("still undoes the steps before it when a step before it fails", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Fails())
        .commit()
        .finish(() => "done");

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual(["run first", "undo first"]);
    });
  });

  describe("a step that ends the wizard", () => {
    it("answers with its result and runs nothing after it", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .endWhen(new EndsWhen(true))
        .step(new Adds("first", 1))
        .finish(() => "finished normally");

      const answer = await wizard.run(services, { input: "x" });

      expect({ answer, log: services.log }).toEqual({ answer: "ended on x", log: [] });
    });

    it("lets the wizard go on when it does not apply", async () => {
      const wizard = started()
        .endWhen(new EndsWhen(false))
        .step(new Adds("first", 1))
        .finish(() => "finished normally");

      const answer = await wizard.run({ log: [] }, { input: "x" });

      expect(answer).toBe("finished normally");
    });
  });

  describe("a loop", () => {
    it("runs its steps once for each item, in order", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("items", ["a", "b"]))
        .each(
          "passes",
          (state) => state.items,
          (pass) => {
            return pass.step(new ItemStep());
          },
        )
        .finish((state) => state.passes.map((one) => one.label).join(","));

      const answer = await wizard.run(services, { input: "x" });

      expect({ answer, log: services.log }).toEqual({
        answer: "a!,b!",
        log: ["run items", "item a", "item b"],
      });
    });

    it("undoes the passes that finished, then the steps before the loop, when one fails", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("items", ["a", "b", "fail"]))
        .each(
          "passes",
          (state) => state.items,
          (pass) => {
            return pass.step(new ItemStep());
          },
        )
        .finish(() => "done");

      await wizard.run(services, { input: "x" }).catch(() => undefined);

      expect(services.log).toEqual([
        "run items",
        "item a",
        "item b",
        "item fail",
        "undo item b",
        "undo item a",
        "undo items",
      ]);
    });

    it("runs nothing for an empty list", async () => {
      const services: Services = { log: [] };
      const wizard = started()
        .step(new Adds("items", [] as string[]))
        .each(
          "passes",
          (state) => state.items,
          (pass) => {
            return pass.step(new ItemStep());
          },
        )
        .finish((state) => String(state.passes.length));

      const answer = await wizard.run(services, { input: "x" });

      expect(answer).toBe("0");
    });
  });

  describe("reporting progress", () => {
    it("tells the observer when each step starts and finishes", async () => {
      const events: StepEvent[] = [];
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Adds("second", 2))
        .finish(() => "done");

      await wizard.run({ log: [] }, { input: "x" }, { onStep: (event) => events.push(event) });

      expect(events).toEqual([
        { key: "first", phase: "started" },
        { key: "first", phase: "completed" },
        { key: "second", phase: "started" },
        { key: "second", phase: "completed" },
      ]);
    });

    it("tells the observer when a step is undone", async () => {
      const events: StepEvent[] = [];
      const wizard = started()
        .step(new Adds("first", 1))
        .step(new Fails())
        .finish(() => "done");

      await wizard
        .run({ log: [] }, { input: "x" }, { onStep: (event) => events.push(event) })
        .catch(() => undefined);

      expect(events.filter((event) => event.phase === "undone")).toEqual([
        { key: "first", phase: "undone" },
      ]);
    });
  });
});

/**
 * One pass of a loop: logs its item, and fails on the item `fail`.
 */
class ItemStep extends WizardStep<
  "item",
  { readonly label: string },
  Initial & { readonly item: string },
  Services
> {
  readonly key = "item";

  async run(
    needs: Initial & { readonly item: string },
    services: Services,
  ): Promise<{ readonly label: string }> {
    services.log.push(`item ${needs.item}`);
    if (needs.item === "fail") {
      throw new Error("boom");
    }
    return { label: `${needs.item}!` };
  }

  override async undo(
    out: { readonly label: string },
    needs: Initial & { readonly item: string },
    services: Services,
  ): Promise<void> {
    services.log.push(`undo item ${needs.item}`);
    void out;
  }
}
