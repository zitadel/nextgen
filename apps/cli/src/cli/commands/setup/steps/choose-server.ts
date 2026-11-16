import { LocalServer } from "@/lib/server";
import { Server } from "@/lib/server";
import { sameLocalServer } from "@/lib/server/local/runtime";
import { WizardStep } from "@/lib/wizard";

import type { Fact, PromptContext, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";
import { outdatedLocalServer, promptContext } from "@/cli/commands/setup/shared";

/**
 * The value the choice select returns when the person picks "Custom URL".
 */
const CUSTOM = "__custom__";

/**
 * The value of the disabled local option, which can never be picked.
 */
const LOCAL_NOT_RUNNING = "__local_not_running__";

/**
 * The value of the disabled option for a local server another CLI release
 * started, which can never be picked.
 */
const LOCAL_OUTDATED = "__local_outdated__";

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
 * available. A detected server another CLI release started is listed the same
 * way, saying to restart it: its API is that release's, and setup would stop
 * halfway against it. Picking a server writes its URL directly to
 * `answers.server`; picking "Custom URL" still asks for a URL, validated and
 * normalised to its origin the way `--server` is.
 */
export class ChooseServer extends WizardStep<"server", Fact<"answers">, Needs> {
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
   * Ask which server the app uses.
   *
   * @remarks
   * `--server <url>` overrides the wizard entirely. The command already validated and resolved the
   * URL into `answers.server`, and a fixed list of Cloud, the detected server and a custom URL may
   * not hold the flag's value, so the select would silently fall back to Cloud.
   *
   * The local server is probed in a spinner: the `/readyz` probe of a server that does not answer
   * takes up to 1.5s, long enough that the wizard should say what it is doing. The spinner then
   * clears instead of leaving a line behind, because the options it decides already say what it
   * found, and it draws no guide line of its own, which clearing would leave behind.
   *
   * A local server another CLI release started is not offered, and its URL typed as a custom one
   * is asked for again: the question keeps the wizard going where a refusal would end it after
   * the questions before this one were answered.
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
    const outdated = await outdatedLocalServer(ctx.cwd);
    probing.clear();
    const usable =
      detected && !(outdated && sameLocalServer(outdated.serverUrl, detected))
        ? detected
        : undefined;
    const choice = await ctx.ask.select({
      name: "server",
      message: "Which Zitadel server should your app use?",
      options: [
        {
          value: Server.DEFAULT,
          label: `Zitadel Cloud (${new URL(Server.DEFAULT).host})`,
        },
        usable
          ? {
              value: usable,
              label: `Local server (${usable})`,
              hint: "already running on this machine",
            }
          : detected && outdated
            ? {
                value: LOCAL_OUTDATED,
                label: `Local server (${detected})`,
                hint: `runs ${outdated.running}, this CLI ships ${outdated.expected} — restart it first`,
                disabled: true,
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
      initialValue: usable ?? answers.server ?? Server.DEFAULT,
    });
    return {
      ...answers,
      server:
        choice === CUSTOM
          ? await ctx.ask.text({
              name: "server URL",
              message: "What is the URL of your Zitadel server?",
              placeholder: "https://zitadel.internal",
              parse: (value) => {
                const parsed = Server.parse(value);
                return parsed.ok && outdated && sameLocalServer(outdated.serverUrl, parsed.value)
                  ? {
                      ok: false,
                      problem: `That local server runs ${outdated.running}, but this CLI ships ${outdated.expected}. Restart it first, or enter another URL`,
                    }
                  : parsed;
              },
            })
          : choice,
    };
  }
}
