import { LocalRuntime, ZitadelRuntime } from "@/lib/server";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { outdatedLocalServer } from "@/cli/commands/setup/shared";

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
  "ask" | "cwd" | "dryRun" | "machine" | "nonInteractive" | "serverFlag" | "ui"
>;

/**
 * "Which Zitadel server should your app use?" — Zitadel Cloud, the managed
 * local server, or a custom URL. Setup creates the project there, so the
 * question names the server and not the file that records it.
 *
 * Before asking, it looks for a healthy local Zitadel server the same way the
 * rest of the CLI does (`LocalRuntime.detectUrl`: the server the runtime
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
   * Ask which server the app uses, or leave the answers as they are when nothing can be asked.
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
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, with the server settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { answers } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun || this.deps.serverFlag) {
      return {
        answers,
      };
    }
    const probing = this.deps.ui.spinner("Checking for a local Zitadel server", { guide: false });
    const detected = await this.deps.machine.detectUrl(this.deps.cwd);
    const outdated = await outdatedLocalServer(this.deps.cwd, this.deps.machine);
    probing.clear();
    const usable =
      detected && !(outdated && LocalRuntime.same(outdated.serverUrl, detected))
        ? detected
        : undefined;
    const choice = await this.deps.ask.select({
      name: "server",
      message: "Which Zitadel server should your app use?",
      options: [
        {
          value: ZitadelRuntime.DEFAULT,
          label: `Zitadel Cloud (${new URL(ZitadelRuntime.DEFAULT).host})`,
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
      initialValue: usable ?? answers.server ?? ZitadelRuntime.DEFAULT,
    });
    return {
      answers: {
        ...answers,
        server:
          choice === CUSTOM
            ? await this.deps.ask.text({
                name: "server URL",
                message: "What is the URL of your Zitadel server?",
                placeholder: "https://zitadel.internal",
                parse: (value) => {
                  const parsed = ZitadelRuntime.parse(value);
                  return parsed.ok &&
                    outdated &&
                    LocalRuntime.same(outdated.serverUrl, parsed.value)
                    ? {
                        ok: false,
                        problem: `That local server runs ${outdated.running}, but this CLI ships ${outdated.expected}. Restart it first, or enter another URL`,
                      }
                    : parsed;
                },
              })
            : choice,
      },
    };
  }
}
