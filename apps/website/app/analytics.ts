import { track } from "@vercel/analytics";

import {
  actorEventsCommand,
  agentPrompt,
  correlationEventsCommand,
  customSsoCommand,
  deployCommand,
  devCommand,
  dryRunCommand,
  failedRequestsCommand,
  googleDisableCommand,
  googleEnableCommand,
  grantCreateCommand,
  grantDeleteCommand,
  grantListCommand,
  idpListCommand,
  invitationCommand,
  membersCommand,
  passkeyEnableCommand,
  policyTestCommand,
  rollbackCommand,
  setupCommand,
  signInAsk,
  skillsCommand,
  startCommand,
  userEventsCommand,
  userListCommand,
  userSignInsCommand,
  teamCreateCommand,
  teamListCommand,
  teamGetCommand,
  teamDeactivateCommand,
  apiListCommand,
  applicationPublishCommand,
  applicationGetCommand,
} from "./commands";

// The website's custom events in Vercel Web Analytics, as
// docs/product-analytics-events.yaml defines them: what page views cannot
// show, a command copied, a call to action followed and a tab chosen. The
// <Analytics /> of
// layout.tsx sends them in production and logs them in development. They go
// from the browser like the page views, so a blocker drops a visitor from
// both and the ratios between them hold.

/**
 * Where on its page a copy button or a call to action sits: `header` is the
 * bar over every page, `showcase` the quickstart's walkthrough on
 * /get-started, `try_it` the Try it of a phase or a feature page
 * (phase-page.tsx, feature-page.tsx), whose page the event's `page` names,
 * and `closing` the front page's closing band.
 */
export type Placement = "header" | "hero" | "showcase" | "try_it" | "closing" | "footer";

/**
 * Where a call to action leads, as a stable name, never a URL: `get_started`
 * is /get-started, `sign_up` the cloud's sign-up and `contact` zitadel.com's
 * contact page; `sign_in`, `organizations`, `single_sign_on`, `permissions`,
 * `oauth_server`, `scim` and `agents` are those feature pages and
 * `investigate` that phase page, from the hero's capabilities.
 */
export type Target =
  | "quickstart"
  | "github"
  | "get_started"
  | "sign_up"
  | "contact"
  | "sign_in"
  | "organizations"
  | "single_sign_on"
  | "permissions"
  | "oauth_server"
  | "scim"
  | "agents"
  | "investigate";

/** A tab of the front page's start window: with your agent, or in your terminal. */
export type Tab = "with_agent" | "in_terminal";

/**
 * What a copy button copied, never its text: `all` is a whole block of
 * commands, `event_list` any `event list` a page offers, `auth_method` any
 * `auth-method` command, `ask` the ask for your agent, `agent_prompt` the
 * front page's prompt for your agent.
 */
export type Snippet =
  | "all"
  | "ask"
  | "agent_prompt"
  | "start"
  | "setup"
  | "dev"
  | "dry_run"
  | "deploy"
  | "skills"
  | "policy_test"
  | "rollback"
  | "grant_list"
  | "grant_create"
  | "grant_delete"
  | "members"
  | "event_list"
  | "auth_method"
  | "idp_list"
  | "user_list"
  | "invitation_create"
  | "team_create"
  | "team_list"
  | "team_get"
  | "team_deactivate"
  | "api_ls"
  | "application_publish"
  | "application_get";

const SNIPPETS = new Map<string, Snippet>([
  [startCommand, "start"],
  [setupCommand, "setup"],
  [devCommand, "dev"],
  [dryRunCommand, "dry_run"],
  [deployCommand, "deploy"],
  [skillsCommand, "skills"],
  [signInAsk, "ask"],
  [agentPrompt, "agent_prompt"],
  [policyTestCommand, "policy_test"],
  [rollbackCommand, "rollback"],
  [grantListCommand, "grant_list"],
  [grantDeleteCommand, "grant_delete"],
  [userEventsCommand, "event_list"],
  [userSignInsCommand, "event_list"],
  [actorEventsCommand, "event_list"],
  [correlationEventsCommand, "event_list"],
  [failedRequestsCommand, "event_list"],
  [passkeyEnableCommand, "auth_method"],
  [googleEnableCommand, "auth_method"],
  [googleDisableCommand, "auth_method"],
  [customSsoCommand, "auth_method"],
  [idpListCommand, "idp_list"],
  [grantCreateCommand, "grant_create"],
  [membersCommand, "members"],
  [userListCommand, "user_list"],
  [invitationCommand, "invitation_create"],
  [teamCreateCommand, "team_create"],
  [teamListCommand, "team_list"],
  [teamGetCommand, "team_get"],
  [teamDeactivateCommand, "team_deactivate"],
  [apiListCommand, "api_ls"],
  [applicationPublishCommand, "application_publish"],
  [applicationGetCommand, "application_get"],
]);

/** The snippet `command` is, or `undefined` for a command the catalog has no name for. */
export function snippetOf(command: string): Snippet | undefined {
  return SNIPPETS.get(command);
}

type Events = {
  copied_command: { snippet: Snippet; placement: Placement };
  clicked_link: { target: Target; placement: Placement };
  selected_tab: { tab: Tab; placement: Placement };
};

/**
 * A page's stable name: `home` for `/`, a feature page's two segments
 * (`platform/sign-in`), else its first path segment.
 */
export function pageOf(pathname: string): string {
  const [, first = "", second] = pathname.split("/");
  if (first === "platform" && second) {
    return `platform/${second}`;
  }
  return first || "home";
}

/**
 * Sends `event` with the header every website event carries: `surface` and,
 * on Vercel, the commit the website was deployed from (next.config.ts).
 */
export function trackEvent<E extends keyof Events>(event: E, properties: Events[E]): void {
  const version = process.env.WEBSITE_VERSION;
  track(event, {
    surface: "website",
    ...(version ? { website_version: version } : {}),
    page: pageOf(window.location.pathname),
    ...properties,
  });
}
