import { Claim } from "@/lib/claim";
import type { BoxAction } from "@/lib/ui";

import type { Suggest, SuggestedCommand } from "./index";
import { WHAT_CHANGED } from "./what-changed";

/**
 * Guidance copy that commands share, so the story does not fork; most of it is
 * the journey-staged copy of `setup` and `status`.
 *
 * The staging exists because of alpha tester feedback: printing customize and
 * publish steps before the user has logged in once reads as noise, but
 * dropping them entirely recreates the dead end where nothing pointed to the
 * next step. So the guidance tracks journey position (verify first, customize
 * and publish once login demonstrably works), and both commands quote the same
 * copy.
 */
export class Guidance {
  /** Renders a suggestion for the run that reports it. */
  private readonly suggest: Suggest;

  /**
   * @param suggest - Renders a suggestion for the run that reports it, so a
   *   quoted command publishes to the project the run was about.
   */
  constructor(suggest: Suggest) {
    this.suggest = suggest;
  }

  /**
   * The verify mission: prove the scaffolded auth round-trips before touching
   * config.
   *
   * @param openUrl - The browser destination, for callers that have not already
   *   narrated it (setup's box has a separate "Start your project" line;
   *   status has only the issuer).
   * @returns The action.
   */
  static verifyLogin(openUrl?: string): string {
    const open = openUrl ? `open ${openUrl}, ` : "";
    return `Verify auth in the browser: ${open}register a user, sign out, sign in again with the same user, and confirm /profile shows Signed in.`;
  }

  /**
   * Where to look when something fails against the local server, shared by
   * `start` and `doctor`. A sign-in step only says that a provider or a check
   * failed, because the login is public; the server logs why.
   *
   * @returns The action.
   */
  serverLog(): string {
    return (
      "When a sign-in or a request fails, the server's log says why: run " +
      `${this.suggest({ id: "logs", flags: { follow: true } })} in another terminal to watch it.`
    );
  }

  /**
   * The customize and publish pair.
   *
   * @returns The two actions.
   */
  customizeAndPublish(): string[] {
    return [
      "Customize what you ask for and how people sign in: edit .zitadel/schemas/ to change " +
        "the information you collect, and .zitadel/flows/ to change the sign-up/sign-in " +
        "experience. Each folder has a README with examples.",
      `See your changes before they go live: ${this.suggest({ id: "deploy", flags: { dryRun: true } })} to ` +
        `preview, then ${this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } })} to publish. The project ` +
        "serves only what is deployed, so an edit takes effect once you deploy it.",
    ];
  }

  /**
   * The opt-in first end-to-end test, offered once a sign-in has worked. It is
   * prose and never a `next_commands` entry: `tests add` installs Playwright,
   * which an agent following `next_commands` would do unasked.
   *
   * @returns The action.
   */
  tests(): string {
    return `Keep the sign-in working with an end-to-end test whenever you want one: ${this.suggest({ id: "tests:add" })} adds Playwright tests on @zitadel/testing and installs them as dev dependencies.`;
  }

  /**
   * How to change the login's look after setup. Setup never ejects a template
   * or publishes a branding revision: the app embeds the maintained
   * `<zitadel-login>`, so its look is the app's own CSS (`--zl-*` tokens) and
   * layout around it. Taking ownership of the widget's structure stays the
   * opt-in `branding eject`, surfaced here so it remains discoverable.
   *
   * @returns The action.
   */
  branding(): string {
    return `Change how the login looks: it is a component in your app, so theme it with --zl-* custom properties in your own stylesheet and build any page layout around it in your code. To change the widget's structure, ${this.suggest({ id: "branding:eject" })} scaffolds an editable template in .zitadel/branding/.`;
  }

  /**
   * The command for `next_commands`.
   *
   * @returns The `claim` command.
   */
  claimCommand(): SuggestedCommand {
    return this.suggest({ id: "claim" });
  }

  /**
   * The one claim nudge for `next_actions`, shared by `setup`, `status` and
   * `doctor`, quoting the command in prose. The command carries the run's own
   * scope, so it targets the project this run is about rather than whatever
   * the next shell's environment resolves to.
   *
   * @param deadline - When the claim window closes, if it is known.
   * @returns The nudge.
   */
  claimNudge(deadline: Date | undefined): string {
    return `${Claim.sentence(deadline)} Run ${this.claimCommand()}.`;
  }

  /**
   * The same nudge for the human box, with the command on its own styled line.
   *
   * @param deadline - When the claim window closes, if it is known.
   * @returns The box action.
   */
  claimBoxNudge(deadline: Date | undefined): BoxAction {
    return {
      text: Claim.sentence(deadline),
      command: this.claimCommand(),
    };
  }

  /**
   * The nudge's counterpart for a closed claim window. Deliberately framed as
   * reconciliation, not a verdict: the local record can be stale in one
   * direction (a project claimed from another machine still reads detached
   * here), so "window closed" from local data alone must not send the user off
   * to duplicate a project that is already attached and working. Running
   * `claim` is safe either way: the server checks the grant before the window,
   * so an attached project answers with a clean already-claimed skip, and only
   * a genuinely unattached one gets the final refusal.
   *
   * @returns The nudge.
   */
  claimWindowClosedNudge(): string {
    return (
      `The local record says this project's ${Claim.WINDOW_DAYS}-day claim window has ` +
      `closed. Run ${this.claimCommand()} to reconcile: a project ` +
      "claimed from another machine confirms its team, and one never claimed can no " +
      `longer be claimed. ${this.suggest({ id: "setup", flags: { cwd: Claim.FRESH_DIRECTORY } })} in a fresh directory ` +
      "gets you a new project you can claim."
    );
  }
}
