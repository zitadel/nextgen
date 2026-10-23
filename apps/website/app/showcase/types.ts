import type { ZlField } from "@zitadel/components/atoms";

/**
 * What setup writes into the app, under `root`: the `command` that writes
 * it, the files that matter, each with what it is (`highlight` for the ones
 * the next steps edit, `page` for the ones the browser beside it can open),
 * and a line for the rest.
 */
export type Scaffold = {
  root: string;
  command: string;
  entries: { path: string; note: string; highlight?: boolean; page?: Page }[];
  rest: string;
};

/** A line of a file in an editor card: unchanged, added or removed. */
export type FileLine = { type: "context" | "added" | "removed"; text: string };

export type ArtifactFile = { path: string; lines: FileLine[] };

/**
 * A step of a flow in the editor card's strip: its name, or its name and the
 * field it takes over from a step the change removed.
 */
export type FlowStep = string | { name: string; adds: string };

/**
 * The changed files of a row as an editor card: the recorded diff, for a flow
 * the graph of its steps before and after, and the commands that publish the
 * change with the one line of their output that matters.
 */
export type Artifact = {
  files: ArtifactFile[];
  graph?: { before: FlowStep[]; after: FlowStep[] };
  commands?: { command: string; output?: string }[];
};

/**
 * A step of the login as the default template renders it, in its English
 * copy: the title and the line under it, the fields, the action, and the line
 * under the action with its link.
 */
export type Screen = {
  title: string;
  subtitle?: string;
  fields: { label: string; type?: ZlField["type"]; placeholder?: string; required?: boolean }[];
  action: string;
  nav?: { lead: string; link: string };
};

/**
 * A page of the app at `url`: the screens of its flow in order. The action of
 * each leads to the next, and the last one's back to the first.
 */
export type Page = { url: string; screens: Screen[] };

/**
 * What a step produced, a page in a browser frame; with `before`, the page
 * before the change, and the frame switches between the two.
 */
export type Result = Page & { before?: Screen[] };

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
