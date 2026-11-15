import { LocalServer } from "@/lib/local-server/server";
import { WizardStep } from "@/lib/wizard";

import type { Fact, PromptContext, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";
import { PORT, promptContext } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
>;

/**
 * "Port 3000 is in use. Which port should your app run on?" — asked only when
 * something already holds the detected port. A free one is nearly always the
 * answer, and a question whose answer is Enter is one more step for nothing:
 * the summary shows the port, and `setup --dev-port` moves a set-up app later.
 * A taken one is worth the question, because setup pins the dev script to the
 * port and the dev server then fails to start on it.
 *
 * The suggestion is the next free port, so Enter, which the developer has
 * pressed at every question before this one, gives a port the dev server can
 * start on. If what holds the detected port is this app's own dev server, the
 * next one works as well, and the detected one can still be typed back. The
 * validated answer becomes the issuer URL (`http://localhost:<port>`) via
 * `issuerFromPort`.
 */
export class ChooseDevPort extends WizardStep<"devPort", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "devPort";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask the question, or leave the answers as they are when nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, with this question's settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    if (this.deps.nonInteractive || this.deps.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: await this.ask(needs.answers, promptContext(needs, this.deps)),
    };
  }

  /**
   * Ask which port the app runs on, when the detected one is taken.
   *
   * @remarks
   * `--dev-port <n>` is authoritative: the prompt is skipped so an interactive answer cannot
   * override the explicit flag, which the command already folded into `answers.devPort`.
   *
   * With the next ones all taken too, the detected port is still the best guess.
   *
   * @param answers - The answers so far.
   * @param ctx - What the question needs to ask.
   * @returns The answers, with the port settled.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.devPortFromFlag || (await LocalServer.isPortFree(answers.devPort))) {
      return answers;
    }
    const suggested = String((await LocalServer.nextFreePort(answers.devPort)) ?? answers.devPort);
    return {
      ...answers,
      devPort: await ctx.ask.text({
        name: "dev server port",
        message: `Port ${answers.devPort} is in use. Which port should your app run on?`,
        placeholder: suggested,
        initialValue: suggested,
        parse: (value) => {
          const parsed = PORT.schema.safeParse(value);
          return parsed.success
            ? {
                ok: true,
                value: parsed.data,
              }
            : {
                ok: false,
                problem: "Must be a port number",
              };
        },
      }),
    };
  }
}
