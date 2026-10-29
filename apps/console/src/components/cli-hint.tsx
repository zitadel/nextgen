import type { ReactNode } from "react";

import { DEFAULT_SERVER } from "@zitadel/config/server";

import { InlineCode } from "@/components/ui/inline-code";

/**
 * The CLI the footers tell an operator to run (decisions log D0b): the
 * published package, invoked without installing it, from npm's `latest` tag
 * (docs/adrs/074-preview-releases-on-0x.md).
 */
export const CLI = "npx @zitadel/cli@latest";

/** `apply`: writes the local definitions to the project. */
export const CLI_DEPLOY = `${CLI} deploy`;

/** `variable set`: enters or changes a project's variables and secrets. */
export const CLI_VARIABLE_SET = `${CLI} variable set`;

/**
 * `setup`: creates a project and connects the app in the current directory.
 * It names the server unless that is the CLI's default: the CLI takes its
 * server from `--server`, `ZITADEL_SERVER` or `zitadel.json` and otherwise
 * the hosted default, and never finds a running local server by itself. A
 * local server is recognised by its URL, so the project is attached to the
 * local admin's team as with `--server local`.
 */
export function cliSetup(server: string): string {
  return server === DEFAULT_SERVER ? `${CLI} setup` : `${CLI} setup --server ${server}`;
}

/**
 * The footer line under a document or a resource table that says how to change
 * what it shows from the CLI. It sits inside the bordered panel, ruled off
 * above.
 *
 * Inline flow, not a flex row: the design is three auto-layout children with a
 * 4px gap, which puts a space in front of the full stop. Normal inline text
 * wraps the same way and lets the punctuation hug the command.
 */
export function CliHint({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-border py-3 pr-3 pl-4 text-xs leading-4 text-muted-foreground">
      {children}
    </p>
  );
}

/** A CLI command inside a `CliHint`. */
export function CliCommand({ children }: { children: string }) {
  return <InlineCode className="text-[10px]">{children}</InlineCode>;
}
