"use client";

import { type Placement, trackEvent } from "./analytics";
import { agentPrompt } from "./commands";
import { CheckIcon, CopyIcon, useCopy } from "./copy-button";
import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { phasePath } from "./phases";

const BUTTON =
  "group inline-flex h-11 items-center gap-2 rounded-lg px-5 font-semibold text-sm transition-colors";
const FILLED = "bg-text-primary text-background hover:opacity-85";
const OUTLINED =
  "border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]";

function Arrow() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-4 transition-transform group-hover:translate-x-0.5"
    >
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A way on as a quiet link at a button's height, beside the buttons.
const QUIET =
  "group inline-flex h-11 items-center gap-2 px-1 font-semibold text-sm text-text-secondary transition-colors hover:text-text-primary";

/**
 * Copies the prompt that has your agent set Zitadel up (commands.ts), and
 * says so in place: both words hold the button's width, so the row never
 * moves. A copy reports `copied_command` as `agent_prompt`.
 */
function CopyPromptButton({ placement }: { placement: Placement }) {
  const { copied, copy } = useCopy(agentPrompt, { snippet: "agent_prompt", placement });
  return (
    <>
      <button type="button" onClick={copy} title={agentPrompt} className={`${BUTTON} ${OUTLINED}`}>
        {copied ? <CheckIcon /> : <CopyIcon className="size-4" />}
        <span className="grid">
          <span className={`[grid-area:1/1] ${copied ? "invisible" : ""}`}>
            Copy prompt for your agent
          </span>
          <span aria-hidden="true" className={`[grid-area:1/1] ${copied ? "" : "invisible"}`}>
            Copied
          </span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

/**
 * The front page's ways to start, in the hero and in its closing band: the
 * cloud's sign-up, the prompt for your agent to copy, and, quieter, running
 * it yourself from the quickstart's walkthrough (/get-started); with `talk`,
 * a quiet link to talk to us. Two buttons, the rest links. A click reports
 * `clicked_link` with `placement` (analytics.ts): page views cannot say which
 * button sent a visitor on, and the sign-up and the contact page are other
 * apps.
 */
export function StartButtons({
  placement,
  talk = false,
  className = "",
}: {
  placement: Placement;
  talk?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-2 ${className}`}>
      <a
        href={links.signUp}
        onClick={() => trackEvent("clicked_link", { target: "sign_up", placement })}
        className={`${BUTTON} ${FILLED}`}
      >
        Start in our cloud
        <Arrow />
      </a>
      <CopyPromptButton placement={placement} />
      <a
        href={phasePath("get-started")}
        onClick={() => trackEvent("clicked_link", { target: "get_started", placement })}
        className={QUIET}
      >
        Run it yourself
        <Arrow />
      </a>
      {talk && (
        <a
          href={links.contact}
          onClick={() => trackEvent("clicked_link", { target: "contact", placement })}
          className={QUIET}
        >
          Talk to us
        </a>
      )}
    </div>
  );
}

/**
 * The ways on at the end of the showcase's steps: the quickstart, the one
 * thing to do next, and the code. A click reports `clicked_link` with
 * `placement` (analytics.ts): page views cannot say which page sent a visitor
 * to the quickstart, and GitHub is another site.
 */
export function CallToAction({
  placement,
  className = "",
}: {
  placement: Placement;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      <a
        href={links.quickstart}
        onClick={() => trackEvent("clicked_link", { target: "quickstart", placement })}
        className={`${BUTTON} ${FILLED}`}
      >
        Read the quickstart
        <Arrow />
      </a>
      <a
        href={links.github}
        onClick={() => trackEvent("clicked_link", { target: "github", placement })}
        className={`${BUTTON} ${OUTLINED}`}
      >
        <GitHubMark className="size-4" />
        View on GitHub
      </a>
    </div>
  );
}

/**
 * The header's one primary button, to the first phase's page, in the filled
 * style of the quickstart's button at the bar's height. A click reports
 * `clicked_link`: the page views of /get-started cannot say that the header
 * sent the visitor.
 */
export function GetStartedButton() {
  return (
    <a
      href={phasePath("get-started")}
      onClick={() => trackEvent("clicked_link", { target: "get_started", placement: "header" })}
      className="ml-1 inline-flex h-9 shrink-0 items-center rounded-xl bg-text-primary px-3 font-semibold text-background text-sm transition-opacity hover:opacity-85 sm:px-3.5"
    >
      Get started
    </a>
  );
}
