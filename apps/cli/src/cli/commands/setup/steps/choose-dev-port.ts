import type { Parsed } from "@zitadel/config/idp";
import { z } from "zod";
import { type Refused, whole } from "@/lib/oclif/flags";
import { LocalServer } from "@/lib/local-server/server";

import type { Fact, PromptContext, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/**
 * The lowest TCP port a server can listen on.
 */
const MIN_PORT = 1;

/**
 * The highest TCP port a server can listen on.
 */
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
} as const satisfies Refused<number>;

/**
 * What the step reads from what is known.
 */
type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

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
export class ChooseDevPort extends WizardStep<"devPort", Fact<"answers">, QuestionNeeds> {
  readonly key = "devPort";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask the question, or leave the answers as they are when nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @param this.deps - What the command provides.
   * @returns The answers, with this question's settled.
   */
  async run(needs: QuestionNeeds): Promise<Fact<"answers">> {
    const { app, flags, orca, scaffoldedFramework } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: await this.ask(needs.answers, {
        ask: this.deps.ask,
        note: (title, lines) => {
          this.deps.ui.note(title, lines);
        },
        say: (text) => {
          this.deps.ui.say(text);
        },
        spinner: (label, options) => {
          return this.deps.ui.spinner(label, options);
        },
        framework: {
          id: app.framework,
          displayName: orca.displayName(app.framework),
        },
        suggest: this.deps.suggest,
        cwd: this.deps.cwd,
        frameworkChosen: scaffoldedFramework || flags.framework !== undefined,
        serverFlag: this.deps.serverFlag,
        devPortFromFlag: flags.devPort !== undefined,
        presetFromFlag: flags.preset !== undefined,
        useCaseFromFlag: flags.useCase !== undefined,
        ssoFromFlag: flags.sso !== undefined,
        passwordMinLengthFromFlag: flags.passwordMinLength !== undefined,
        developmentBuild: isDevelopmentBuild(),
      }),
    };
  }

  /**
   * Ask which port the app runs on, when the detected one is taken.
   *
   * @remarks
   * `--dev-port <n>` is authoritative: skip the prompt so an interactive answer can't override the
   * explicit flag (the base command already folded it into answers.devPort).
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
        parse: readPort,
      }),
    };
  }
}

/**
 * The port a value names, for the dev-port prompt, so a port typed at the
 * prompt and one passed as `--dev-port` are held to the same rule.
 *
 * @param value - What was typed.
 * @returns The port, or what is wrong with the value.
 */
export function readPort(value: string): Parsed<number> {
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
}
