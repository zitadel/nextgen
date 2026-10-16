import type { ZlField } from "@zitadel/components/atoms";

/**
 * What setup writes into the app, under `root`: the files that matter, each
 * with what it is (`highlight` for the ones the next rows edit), and a line
 * for the rest.
 */
export type Scaffold = {
  root: string;
  entries: { path: string; note: string; highlight?: boolean }[];
  rest: string;
};

/** A line of a file in an editor card: unchanged, added or removed. */
export type FileLine = { type: "context" | "added" | "removed"; text: string };

export type ArtifactFile = { path: string; lines: FileLine[] };

/**
 * The changed files of a row as an editor card: the recorded diff, for a flow
 * the graph of its steps before and after, and the commands that publish the
 * change with the one line of their output that matters.
 */
export type Artifact = {
  files: ArtifactFile[];
  graph?: { before: string[]; after: string[] };
  commands?: { command: string; output?: string }[];
};

/**
 * A step of the login as the default template renders it, in its English
 * copy: the title and the line under it, the fields, the action, and the line
 * under the action with its link.
 */
export type Screen = {
  title: string;
  subtitle: string;
  fields: { label: string; type?: ZlField["type"]; placeholder?: string; required?: boolean }[];
  action: string;
  nav: { lead: string; link: string };
};

/**
 * What a row produced, the login's `screen` in a browser frame at `url`; with
 * `before`, the frame switches between the two.
 */
export type Result = { url: string; before?: Screen; screen: Screen };

/** A command of the hero and the lines it printed, in a terminal window titled `title`. */
export type Recording = { title: string; command: string; output: string[] };

/**
 * One step of the showcase: what a command printed, what setup wrote, or the
 * changed files, beside the result when there is a page to show. In
 * `description`, text between backticks is code.
 */
export type Session = {
  label: string;
  description: string;
  recording?: Recording;
  scaffold?: Scaffold;
  artifact?: Artifact;
  result?: Result;
};
