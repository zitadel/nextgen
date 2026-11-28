"use client";

import { type Placement, type Target, trackEvent } from "./analytics";
import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { phasePath } from "./phases";
import { featurePath } from "./platform";

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

/**
 * The front page's two ways to start, in the hero and in its closing band:
 * the cloud's sign-up, or running it yourself from the quickstart's
 * walkthrough (/get-started); with `talk`, a quieter third to talk to us. A
 * click reports `clicked_link` with `placement` (analytics.ts): page views
 * cannot say which button sent a visitor on, and the sign-up and the contact
 * page are other apps.
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
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      <a
        href={links.signUp}
        onClick={() => trackEvent("clicked_link", { target: "sign_up", placement })}
        className={`${BUTTON} ${FILLED}`}
      >
        Start in our cloud
        <Arrow />
      </a>
      <a
        href={phasePath("get-started")}
        onClick={() => trackEvent("clicked_link", { target: "get_started", placement })}
        className={`${BUTTON} ${OUTLINED}`}
      >
        Run it yourself
      </a>
      {talk && (
        <a
          href={links.contact}
          onClick={() => trackEvent("clicked_link", { target: "contact", placement })}
          className={`${BUTTON} text-text-secondary hover:text-text-primary`}
        >
          Talk to us
        </a>
      )}
    </div>
  );
}

// What you can turn on, in the founder's order: each with the page that
// shows it where there is one, and its name for analytics (analytics.ts).
const CAPABILITIES: readonly { label: string; link?: { href: string; target: Target } }[] = [
  { label: "Login", link: { href: featurePath("sign-in"), target: "sign_in" } },
  {
    label: "Single sign-on",
    link: { href: featurePath("single-sign-on"), target: "single_sign_on" },
  },
  { label: "Organizations" },
  { label: "Permissions", link: { href: featurePath("permissions"), target: "permissions" } },
  { label: "OAuth server" },
  { label: "SCIM" },
  { label: "Agent identity", link: { href: featurePath("agents"), target: "agents" } },
  { label: "Audit trail", link: { href: phasePath("investigate"), target: "investigate" } },
];

/**
 * The hero's capabilities between hairlines, under a label in the steps'
 * small type: what you get, whoever runs it. An item with a page links to it
 * and reports `clicked_link` from the hero; one without stands as text. The
 * items wrap as whole names.
 */
export function CapabilityStrip({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center gap-2.5 border-border-primary border-y py-4 ${className}`}
    >
      <p id="capabilities-label" className="font-mono text-text-muted text-xs leading-4">
        Turn on what you need
      </p>
      <ul
        aria-labelledby="capabilities-label"
        className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm leading-6"
      >
        {CAPABILITIES.map(({ label, link }) => (
          <li key={label} className="whitespace-nowrap">
            {link ? (
              <a
                href={link.href}
                onClick={() =>
                  trackEvent("clicked_link", { target: link.target, placement: "hero" })
                }
                className="text-text-secondary underline decoration-tint/25 underline-offset-4 transition-colors hover:text-text-primary hover:decoration-text-primary"
              >
                {label}
              </a>
            ) : (
              <span className="text-text-secondary">{label}</span>
            )}
          </li>
        ))}
      </ul>
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
