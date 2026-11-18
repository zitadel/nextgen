/**
 * One stage of a {@link Wizard}: it reads what earlier stages settled, does
 * one thing, and hands back the facts it adds.
 *
 * @remarks
 * A step knows nothing about the other steps. It names the shape of what it
 * reads in `Needs`, never another step's class, so the wizard can check at
 * compile time that something earlier provides it. What a step needs from the
 * outside (a terminal, a client, the command's flags) it takes in its own
 * constructor, so the wizard carries nothing for it.
 *
 * Every step runs, so what it adds is always there for the steps after it. A
 * step with nothing to do on this run adds the facts that say so, such as
 * `{ newApp: undefined }`, and does not touch anything.
 *
 * A step undoes its own work. {@link WizardStep.undo} runs when a later step
 * fails, in the reverse order the steps ran, and only for steps that finished.
 * A step with nothing to undo leaves the default, which does nothing.
 *
 * @typeParam Key - The step's name, unique within a wizard.
 * @typeParam Out - The facts the step adds to what is known.
 * @typeParam Needs - The shape of what the step reads from what is known.
 */
export abstract class WizardStep<Key extends string, Out extends object, Needs extends object> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  abstract readonly key: Key;

  /**
   * Do the step's work.
   *
   * @param needs - What earlier steps settled.
   * @returns The facts the step adds.
   */
  abstract run(needs: Needs): Promise<Out>;

  /**
   * Take back what {@link WizardStep.run} did, because a later step failed.
   *
   * @param _out - What the step added when it ran.
   * @returns Once it is undone.
   */
  undo(_out: Out): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A step that can end the wizard: when it applies, nothing after it runs, and
 * its answer is the wizard's.
 *
 * @remarks
 * It is for the path that leaves the rest of the flow out, such as a project
 * that is already set up. It adds no facts, so a later step cannot depend on
 * it, and it has no undo: it applies before anything it would undo has run.
 *
 * @typeParam Key - The step's name, unique within a wizard.
 * @typeParam Result - What the wizard answers when this step ends it.
 * @typeParam Needs - The shape of what the step reads from what is known.
 */
export abstract class EndStep<Key extends string, Result, Needs extends object> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  abstract readonly key: Key;

  /**
   * Whether this step ends the wizard, given what is known.
   *
   * @param needs - What earlier steps settled.
   * @returns Whether to end the wizard here.
   */
  abstract when(needs: Needs): boolean | Promise<boolean>;

  /**
   * What the wizard answers.
   *
   * @param needs - What earlier steps settled.
   * @returns The wizard's answer.
   */
  abstract run(needs: Needs): Promise<Result>;
}
