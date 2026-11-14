import type { EndStep, WizardStep } from "./step";

/**
 * Takes back what the steps up to a point did, newest first.
 */
type Undo = () => Promise<void>;

/**
 * Told what is known right after a step finished, for a caller that reacts to
 * what a step produced without the step knowing.
 */
export type Observer<Known extends object> = (known: Known) => void;

/**
 * How one run behaves.
 */
export type RunOptions = {
  /**
   * Stops the run between steps when it aborts, as the person's Ctrl-C does.
   * What had finished is undone first.
   */
  readonly signal?: AbortSignal;

  /**
   * Told when a step's undo itself failed. The run goes on undoing the steps
   * before it, and the error that started the undo is still the one thrown.
   */
  readonly onUndoError?: (key: string, error: unknown) => void;
};

/**
 * What the compiler says when a step needs answers no earlier step gives: the
 * argument it asks for is this type, so the missing names are in the message.
 */
export type Unmet<Needs extends object, State extends object> = {
  readonly "this step needs answers that no earlier step gives": Exclude<keyof Needs, keyof State>;
};

/**
 * Where a run stands after some of its steps: still going with what is known,
 * or ended by a step with the wizard's answer. Either way it can take back
 * what ran.
 */
type Progress<State extends object, Result> =
  | { readonly kind: "continue"; readonly state: State; readonly undo: Undo }
  | { readonly kind: "end"; readonly result: Result; readonly undo: Undo };

/**
 * Runs the steps added so far.
 */
type Runner<Initial extends object, State extends object, Result> = (
  initial: Initial,
  options: RunOptions,
) => Promise<Progress<State, Result>>;

/**
 * Refuses a wizard that is put together wrongly, such as two steps of one name.
 */
export class WizardDefinitionError extends Error {
  /**
   * Describe how the wizard is wrong.
   *
   * @param message - What is wrong.
   */
  constructor(message: string) {
    super(message);
    this.name = "WizardDefinitionError";
  }
}

/**
 * Does nothing, for the start of a run, where nothing has run to undo.
 *
 * @returns Once it has done nothing.
 */
function nothingToUndo(): Promise<void> {
  return Promise.resolve();
}

/**
 * A wizard being put together: an ordered list of steps, each reading what the
 * steps before it settled, checked by the compiler.
 *
 * @remarks
 * Every call returns a new wizard and leaves the one it was called on as it
 * was, so a wizard can be shared and extended.
 *
 * ```ts
 * const flow = Wizard.named<Input, Report>("setup")
 *   .endWhen(new AlreadySetUp(terminal))
 *   .step(new Detect(terminal), (state) => terminal.say(state.framework))
 *   .step(new DevPort(terminal))
 *   .each("connections", (state) => state.providers, (provider) => {
 *     return provider.step(new ClientId(terminal)).step(new ClientSecret(terminal));
 *   })
 *   .finish((state) => report(state));
 * ```
 *
 * @typeParam Initial - What the run starts from.
 * @typeParam State - Everything known after the steps added so far.
 * @typeParam Result - What the wizard answers.
 */
export class Wizard<Initial extends object, State extends object, Result> {
  /**
   * The wizard's name, for the errors that say how it is wrong.
   */
  readonly name: string;

  /**
   * The step names taken so far.
   */
  private readonly keys: ReadonlySet<string>;

  /**
   * Runs the steps added so far.
   */
  private readonly runner: Runner<Initial, State, Result>;

  /**
   * Hold the steps added so far.
   *
   * @param name - The wizard's name.
   * @param keys - The step names taken.
   * @param runner - Runs the steps.
   */
  private constructor(
    name: string,
    keys: ReadonlySet<string>,
    runner: Runner<Initial, State, Result>,
  ) {
    this.name = name;
    this.keys = keys;
    this.runner = runner;
  }

  /**
   * Start a wizard with no steps, knowing only what the run starts from.
   *
   * @typeParam Initial - What the run starts from.
   * @typeParam Result - What the wizard answers.
   * @param name - The wizard's name.
   * @returns The empty wizard.
   */
  static named<Initial extends object, Result = never>(
    name: string,
  ): Wizard<Initial, Initial, Result> {
    return new Wizard<Initial, Initial, Result>(name, new Set<string>(), (initial) => {
      return Promise.resolve({
        kind: "continue",
        state: initial,
        undo: nothingToUndo,
      });
    });
  }

  /**
   * Add a step that runs after the ones so far.
   *
   * @remarks
   * It does not compile when the step reads something no earlier step gives;
   * the argument it then asks for names what is missing.
   *
   * The observer is told what is known, with what the step added, right after
   * the step finished. It is not told of a step that failed. If it throws, the
   * step is undone with the ones before it and the error is thrown.
   *
   * @param step - The step.
   * @param rest - The observer, if any; or, only when the step needs what is
   *   not known, the argument that names what is missing.
   * @returns The wizard with the step added, knowing what it adds.
   * @throws {@link WizardDefinitionError} When a step already has its name.
   */
  step<Out extends object, Needs extends object>(
    step: WizardStep<string, Out, Needs>,
    ...rest: State extends Needs ? [observe?: Observer<State & Out>] : [Unmet<Needs, State>]
  ): Wizard<Initial, State & Out, Result>;
  step<Out extends object, Needs extends object>(
    step: WizardStep<string, Out, Needs>,
    argument?: Observer<State & Out> | Unmet<Needs, State>,
  ): Wizard<Initial, State & Out, Result> {
    const keys = this.claim(step.key);
    const reader: WizardStep<string, Out, object> = step;
    const observe = typeof argument === "function" ? argument : undefined;
    const runner: Runner<Initial, State & Out, Result> = async (initial, options) => {
      const before = await this.runner(initial, options);
      if (before.kind === "end") {
        return before;
      }
      const attempt = async (): Promise<Progress<State & Out, Result>> => {
        options.signal?.throwIfAborted();
        const out = await reader.run(before.state);
        const undo = async (): Promise<void> => {
          try {
            await reader.undo(out);
          } catch (error) {
            options.onUndoError?.(step.key, error);
          }
          await before.undo();
        };

        return {
          kind: "continue",
          state: {
            ...before.state,
            ...out,
          },
          undo,
        };
      };
      const finished = await attempt().catch(async (error: unknown) => {
        await before.undo();
        throw error;
      });
      if (finished.kind === "continue") {
        try {
          observe?.(finished.state);
        } catch (error) {
          await finished.undo();
          throw error;
        }
      }
      return finished;
    };
    return new Wizard(this.name, keys, runner);
  }

  /**
   * Add a step that may end the wizard: if it applies, nothing after it runs.
   *
   * @param step - The step.
   * @param _unmet - Present only when the step needs what is not known.
   * @returns The wizard with the step added.
   * @throws {@link WizardDefinitionError} When a step already has its name.
   */
  endWhen<Needs extends object>(
    step: EndStep<string, Result, Needs>,
    ..._unmet: State extends Needs ? [] : [Unmet<Needs, State>]
  ): Wizard<Initial, State, Result> {
    const keys = this.claim(step.key);
    const reader: EndStep<string, Result, object> = step;
    const runner: Runner<Initial, State, Result> = async (initial, options) => {
      const before = await this.runner(initial, options);
      if (before.kind === "end") {
        return before;
      }
      const attempt = async (): Promise<Progress<State, Result>> => {
        options.signal?.throwIfAborted();
        const ends = await reader.when(before.state);
        if (!ends) {
          return before;
        }
        const result = await reader.run(before.state);

        return {
          kind: "end",
          result,
          undo: before.undo,
        };
      };
      return attempt().catch(async (error: unknown) => {
        await before.undo();
        throw error;
      });
    };
    return new Wizard(this.name, keys, runner);
  }

  /**
   * Add a list of steps that runs once for each item of a list the earlier
   * steps settled, in order.
   *
   * @remarks
   * Each pass sees everything known so far and the item as `item`. What each
   * pass ends with is collected, in order, under `key`. If a pass fails, the
   * passes before it are undone, newest first, and then the steps before the
   * loop.
   *
   * @param key - The step's name, and where the passes' results are kept.
   * @param source - The items, from what is known.
   * @param build - Builds the steps each pass runs.
   * @returns The wizard with the loop added, knowing each pass's result.
   * @throws {@link WizardDefinitionError} When a step already has its name.
   */
  each<Key extends string, Item, Inner extends object>(
    key: Key,
    source: (state: State) => readonly Item[],
    build: (
      pass: Wizard<State & { readonly item: Item }, State & { readonly item: Item }, never>,
    ) => Wizard<State & { readonly item: Item }, Inner, never>,
  ): Wizard<Initial, State & { readonly [K in Key]: readonly Inner[] }, Result> {
    const keys = this.claim(key);
    const pass = build(
      Wizard.named<State & { readonly item: Item }, never>(`${this.name}.${key}`),
    ).runner;
    const runner: Runner<
      Initial,
      State & { readonly [K in Key]: readonly Inner[] },
      Result
    > = async (initial, options) => {
      const before = await this.runner(initial, options);
      if (before.kind === "end") {
        return before;
      }
      const passes = source(before.state).reduce<
        Promise<{ readonly results: readonly Inner[]; readonly undo: Undo }>
      >(
        async (accumulated, item) => {
          const soFar = await accumulated;
          const progress = await pass(
            {
              ...before.state,
              item,
            },
            options,
          ).catch(async (error: unknown) => {
            await soFar.undo();
            throw error;
          });
          if (progress.kind === "end") {
            throw new WizardDefinitionError(
              `The loop "${key}" in "${this.name}" cannot end the wizard`,
            );
          }
          return {
            results: [...soFar.results, progress.state],
            undo: async (): Promise<void> => {
              await progress.undo();
              await soFar.undo();
            },
          };
        },
        Promise.resolve({
          results: [],
          undo: nothingToUndo,
        }),
      );
      return passes.then(
        (done) => {
          const progress: Progress<State & { readonly [K in Key]: readonly Inner[] }, Result> = {
            kind: "continue",
            state: {
              ...before.state,
              [key]: done.results,
            } as State & { readonly [K in Key]: readonly Inner[] },
            undo: async (): Promise<void> => {
              await done.undo();
              await before.undo();
            },
          };
          return progress;
        },
        async (error: unknown) => {
          await before.undo();
          throw error;
        },
      );
    };
    return new Wizard(this.name, keys, runner);
  }

  /**
   * Mark the point of no return: a step that fails after it no longer takes back
   * the steps before it.
   *
   * @remarks
   * For work that is kept once it is done, such as a new app that is only worth
   * removing while the project around it is still being set up.
   *
   * @returns The wizard with the mark added.
   */
  commit(): Wizard<Initial, State, Result> {
    return new Wizard(this.name, this.keys, async (initial, options) => {
      const before = await this.runner(initial, options);
      if (before.kind === "end") {
        return before;
      }

      return {
        kind: "continue",
        state: before.state,
        undo: nothingToUndo,
      };
    });
  }

  /**
   * Say what the wizard answers when every step has run, which makes it ready
   * to run.
   *
   * @param answer - Builds the answer from everything the steps settled.
   * @returns The wizard, ready to run.
   */
  finish(answer: (state: State) => Result): ReadyWizard<Initial, Result> {
    return new ReadyWizard(this.name, async (initial, options) => {
      const progress = await this.runner(initial, options);
      if (progress.kind === "end") {
        return progress.result;
      }
      try {
        return answer(progress.state);
      } catch (error) {
        await progress.undo();
        throw error;
      }
    });
  }

  /**
   * Take a step's name, refusing one that is taken.
   *
   * @param key - The name.
   * @returns The names taken, with this one.
   * @throws {@link WizardDefinitionError} When the name is taken.
   */
  private claim(key: string): ReadonlySet<string> {
    if (this.keys.has(key)) {
      throw new WizardDefinitionError(`The wizard "${this.name}" already has a step "${key}"`);
    }
    return new Set([...this.keys, key]);
  }
}

/**
 * A wizard that has said what it answers, and so can run.
 *
 * @typeParam Initial - What the run starts from.
 * @typeParam Result - What the wizard answers.
 */
export class ReadyWizard<Initial extends object, Result> {
  /**
   * The wizard's name.
   */
  readonly name: string;

  /**
   * Runs the steps and answers.
   */
  private readonly execute: (initial: Initial, options: RunOptions) => Promise<Result>;

  /**
   * Hold what runs the wizard.
   *
   * @param name - The wizard's name.
   * @param execute - Runs the steps and answers.
   */
  constructor(name: string, execute: (initial: Initial, options: RunOptions) => Promise<Result>) {
    this.name = name;
    this.execute = execute;
  }

  /**
   * Run the steps in order.
   *
   * @remarks
   * When a step fails, or the signal aborts, what had finished is undone, newest
   * first, and the error that stopped the run is thrown.
   *
   * @param initial - What the run starts from.
   * @param options - How the run behaves.
   * @returns What the wizard answers.
   * @throws Whatever stopped the run.
   */
  run(initial: Initial, options: RunOptions = {}): Promise<Result> {
    return this.execute(initial, options);
  }
}
