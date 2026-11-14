import type { Parsed } from "@zitadel/config/idp";

import { LocalServer } from "@/lib/local-server/server";
import { DEFAULT_SERVER } from "@/lib/server";

import type { Fact, PromptContext, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/** Sentinel returned by the choice select when the user picks "Custom URL". */
const CUSTOM = "__custom__";
/** The value of the disabled local option, which can never be picked. */
const LOCAL_NOT_RUNNING = "__local_not_running__";

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
 * "Which Zitadel server should your app use?" — Zitadel Cloud, the managed
 * local server, or a custom URL. Setup creates the project there, so the
 * question names the server and not the file that records it.
 *
 * Before asking, it looks for a healthy local Zitadel server the same way the
 * rest of the CLI does (`LocalServer.detectUrl`: the server the runtime
 * metadata `zitadel start` wrote to `.zitadel/local/runtime.json` names, when
 * its own process answers a `/readyz` probe). A detected server becomes an
 * option *and* the preselected answer — a user who just ran `zitadel start`
 * almost certainly wants it, and `start`'s own next-step hint says
 * `setup --server local`. Without one, the local option is still listed,
 * disabled, saying how to get it, so the choice is visible before it is
 * available. Picking a server writes its URL directly to `answers.server`;
 * picking "Custom URL" still asks for a validated URL.
 */
export class ChooseServer extends WizardStep<"server", Fact<"answers">, QuestionNeeds> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "server";

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
   * Ask which server the app uses.
   *
   * @remarks
   * `--server <url>` overrides the wizard entirely. The base command already validated and resolved
   * the URL into `answers.server`; asking the user to re-pick from a fixed select list when their
   * flag isn't in the list (Cloud / detected / Custom) was a bug — clack would silently default
   * back to Cloud.
   *
   * The local server is probed in a spinner: the `/readyz` probe of a server that does not answer
   * takes up to 1.5s, long enough that the wizard should say what it is doing. The spinner then
   * clears instead of leaving a line behind, because the options it decides already say what it
   * found, and it draws no guide line of its own, which clearing would leave behind.
   *
   * @param answers - The answers so far.
   * @param ctx - What the question needs to ask.
   * @returns The answers, with the server settled.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.serverFlag) {
      return answers;
    }
    const probing = ctx.spinner("Checking for a local Zitadel server", { guide: false });
    const detected = await LocalServer.detectUrl(ctx.cwd);
    probing.clear();

    const choice = await ctx.ask.select({
      name: "server",
      message: "Which Zitadel server should your app use?",
      options: [
        {
          value: DEFAULT_SERVER,
          label: `Zitadel Cloud (${new URL(DEFAULT_SERVER).host})`,
        },
        detected
          ? {
              value: detected,
              label: `Local server (${detected})`,
              hint: "already running on this machine",
            }
          : {
              value: LOCAL_NOT_RUNNING,
              label: "Local server",
              hint: "not running — start it first",
              disabled: true,
            },
        {
          value: CUSTOM,
          label: "Custom URL (self-hosted)",
        },
      ],
      initialValue: detected ?? answers.server ?? DEFAULT_SERVER,
    });
    return {
      ...answers,
      server:
        choice === CUSTOM
          ? await ctx.ask.text({
              name: "server URL",
              message: "What is the URL of your Zitadel server?",
              placeholder: "https://zitadel.internal",
              parse: (value): Parsed<string> => {
                try {
                  new URL(value);
                  return {
                    ok: true,
                    value,
                  };
                } catch {
                  return {
                    ok: false,
                    problem: "Must be a valid URL",
                  };
                }
              },
            })
          : choice,
    };
  }
}
