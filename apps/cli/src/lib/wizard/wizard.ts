import type { EndStep, WizardStep } from "./step";

/**
 * Takes back what the steps up to a point did, newest first.
 */
type Undo = () => Promise<void>;

/**
 * What a step's progress is reported as.
 */
export type StepEvent = {
  /**
   * The step's key.
   */
  readonly key: string;

  /**
   * Whether the step started, finished, or was undone because a later one
   * failed.
   */
  readonly phase: "started" | "completed" | "undone";
};

/**
 * How one run behaves beyond its services.
 */
export type RunOptions = {
  /**
   * Stops the run between steps when it aborts, as the person's Ctrl-C does.
   * What had finished is undone first.
   */
  readonly signal?: AbortSignal;

  /**
   * Told as each step starts, finishes, and is undone, for progress and
   * telemetry.
   */
  readonly onStep?: (event: StepEvent) => void;

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
type Runner<Services, Initial extends object, State extends object, Result> = (
  services: Services,
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
 * Undoes one step, reporting a failure to undo rather than throwing it, so the
 * steps before it are still undone.
 *
 * @param key - The step.
 * @param work - Its undo.
 * @param options - Where to report.
 * @returns Once it is undone, or its failure reported.
 */
async function undoQuietly(key: string, work: Undo, options: RunOptions): Promise<void> {
  try {
    await work();
    options.onStep?.({ key, phase: "undone" });
  } catch (error) {
    options.onUndoError?.(key, error);
  }
}

/**
 * What is known, with a loop's results under the loop's name.
 *
 * @remarks
 * The one assertion in the wizard: the compiler types a computed key of a
 * generic name as a string index, but the value is exactly the state with that
 * one key added, which is the type it returns.
 *
 * @param state - What is known before the loop.
 * @param key - The loop's name.
 * @param results - What each pass ended with, in order.
 * @returns The state with the results added.
 */
function withLoopResults<State extends object, Key extends string, Inner extends object>(
  state: State,
  key: Key,
  results: readonly Inner[],
): State & { readonly [K in Key]: readonly Inner[] } {
  return { ...state, [key]: results } as State & { readonly [K in Key]: readonly Inner[] };
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
 * const flow = Wizard.named<Services, Input, Report>("setup")
 *   .endWhen(new AlreadySetUp())
 *   .step(new Detect())
 *   .step(new DevPort())
 *   .each("connections", (state) => state.providers, (provider) => {
 *     return provider.step(new ClientId()).step(new ClientSecret());
 *   })
 *   .finish((state) => report(state));
 * ```
 *
 * @typeParam Services - What the run provides every step.
 * @typeParam Initial - What the run starts from.
 * @typeParam State - Everything known after the steps added so far.
 * @typeParam Result - What the wizard answers.
 */
export class Wizard<Services, Initial extends object, State extends object, Result> {
  /**
   * The wizard's name, for the errors that say how it is wrong.
   */
  readonly name: string;

  private readonly keys: ReadonlySet<string>;

  private readonly runner: Runner<Services, Initial, State, Result>;

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
    runner: Runner<Services, Initial, State, Result>,
  ) {
    this.name = name;
    this.keys = keys;
    this.runner = runner;
  }

  /**
   * Start a wizard with no steps, knowing only what the run starts from.
   *
   * @typeParam Services - What the run provides every step.
   * @typeParam Initial - What the run starts from.
   * @typeParam Result - What the wizard answers.
   * @param name - The wizard's name.
   * @returns The empty wizard.
   */
  static named<Services, Initial extends object, Result = never>(
    name: string,
  ): Wizard<Services, Initial, Initial, Result> {
    return new Wizard<Services, Initial, Initial, Result>(
      name,
      new Set<string>(),
      (_services, initial) => {
        return Promise.resolve({ kind: "continue", state: initial, undo: nothingToUndo });
      },
    );
  }

  /**
   * Add a step that runs after the ones so far.
   *
   * @remarks
   * It does not compile when the step reads something no earlier step gives;
   * the argument it then asks for names what is missing.
   *
   * @param step - The step.
   * @param _unmet - Present only when the step needs what is not known.
   * @returns The wizard with the step added, knowing what it adds.
   * @throws {@link WizardDefinitionError} When a step already has its name.
   */
  step<Out extends object, Needs extends object>(
    step: WizardStep<string, Out, Needs, Services>,
    ..._unmet: State extends Needs ? [] : [Unmet<Needs, State>]
  ): Wizard<Services, Initial, State & Out, Result> {
    const keys = this.claim(step.key);
    const previous = this.runner;
    const reader: WizardStep<string, Out, object, Services> = step;
    const runner: Runner<Services, Initial, State & Out, Result> = async (
      services,
      initial,
      options,
    ) => {
      const before = await previous(services, initial, options);
      if (before.kind === "end") {
        return before;
      }
      const attempt = async (): Promise<Progress<State & Out, Result>> => {
        options.signal?.throwIfAborted();
        options.onStep?.({ key: step.key, phase: "started" });
        const out = await reader.run(before.state, services);
        options.onStep?.({ key: step.key, phase: "completed" });
        const state = { ...before.state, ...out };
        const undo = async (): Promise<void> => {
          await undoQuietly(
            step.key,
            () => {
              return reader.undo(out, before.state, services);
            },
            options,
          );
          await before.undo();
        };
        return { kind: "continue", state, undo };
      };
      return attempt().catch(async (error: unknown) => {
        await before.undo();
        throw error;
      });
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
    step: EndStep<string, Result, Needs, Services>,
    ..._unmet: State extends Needs ? [] : [Unmet<Needs, State>]
  ): Wizard<Services, Initial, State, Result> {
    const keys = this.claim(step.key);
    const previous = this.runner;
    const reader: EndStep<string, Result, object, Services> = step;
    const runner: Runner<Services, Initial, State, Result> = async (services, initial, options) => {
      const before = await previous(services, initial, options);
      if (before.kind === "end") {
        return before;
      }
      const attempt = async (): Promise<Progress<State, Result>> => {
        options.signal?.throwIfAborted();
        const ends = await reader.when(before.state, services);
        if (!ends) {
          return before;
        }
        options.onStep?.({ key: step.key, phase: "started" });
        const result = await reader.run(before.state, services);
        options.onStep?.({ key: step.key, phase: "completed" });
        return { kind: "end", result, undo: before.undo };
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
      pass: Wizard<
        Services,
        State & { readonly item: Item },
        State & { readonly item: Item },
        never
      >,
    ) => Wizard<Services, State & { readonly item: Item }, Inner, never>,
  ): Wizard<Services, Initial, State & { readonly [K in Key]: readonly Inner[] }, Result> {
    const keys = this.claim(key);
    const previous = this.runner;
    const pass = build(
      Wizard.named<Services, State & { readonly item: Item }, never>(`${this.name}.${key}`),
    ).runner;
    const runner: Runner<
      Services,
      Initial,
      State & { readonly [K in Key]: readonly Inner[] },
      Result
    > = async (services, initial, options) => {
      const before = await previous(services, initial, options);
      if (before.kind === "end") {
        return before;
      }
      const passes = source(before.state).reduce<
        Promise<{ readonly results: readonly Inner[]; readonly undo: Undo }>
      >(
        async (accumulated, item) => {
          const soFar = await accumulated;
          const progress = await pass(services, { ...before.state, item }, options).catch(
            async (error: unknown) => {
              await soFar.undo();
              throw error;
            },
          );
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
        Promise.resolve({ results: [], undo: nothingToUndo }),
      );
      return passes.then(
        (done) => {
          const progress: Progress<State & { readonly [K in Key]: readonly Inner[] }, Result> = {
            kind: "continue",
            state: withLoopResults(before.state, key, done.results),
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
  commit(): Wizard<Services, Initial, State, Result> {
    const previous = this.runner;
    return new Wizard(this.name, this.keys, async (services, initial, options) => {
      const before = await previous(services, initial, options);
      if (before.kind === "end") {
        return before;
      }
      return { kind: "continue", state: before.state, undo: nothingToUndo };
    });
  }

  /**
   * Say what the wizard answers when every step has run, which makes it ready
   * to run.
   *
   * @param answer - Builds the answer from everything the steps settled.
   * @returns The wizard, ready to run.
   */
  finish(answer: (state: State) => Result): ReadyWizard<Services, Initial, Result> {
    const runner = this.runner;
    return new ReadyWizard(this.name, async (services, initial, options) => {
      const progress = await runner(services, initial, options);
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
 * @typeParam Services - What the run provides every step.
 * @typeParam Initial - What the run starts from.
 * @typeParam Result - What the wizard answers.
 */
export class ReadyWizard<Services, Initial extends object, Result> {
  /**
   * The wizard's name.
   */
  readonly name: string;

  private readonly execute: (
    services: Services,
    initial: Initial,
    options: RunOptions,
  ) => Promise<Result>;

  /**
   * Hold what runs the wizard.
   *
   * @param name - The wizard's name.
   * @param execute - Runs the steps and answers.
   */
  constructor(
    name: string,
    execute: (services: Services, initial: Initial, options: RunOptions) => Promise<Result>,
  ) {
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
   * @param services - What every step is given.
   * @param initial - What the run starts from.
   * @param options - How the run behaves.
   * @returns What the wizard answers.
   * @throws Whatever stopped the run.
   */
  run(services: Services, initial: Initial, options: RunOptions = {}): Promise<Result> {
    return this.execute(services, initial, options);
  }
}
