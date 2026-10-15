import type { StaticImageData } from "next/image";

/**
 * A line of a recorded terminal session: `command` is typed at a prompt,
 * `output` is printed as is, `comment` dimmed, `added` and `removed` are diff
 * lines in green and red.
 */
export type TerminalLine = {
  type: "command" | "output" | "comment" | "added" | "removed";
  text: string;
};

/** A recorded terminal session, replayed line by line; `title` is the window's, the directory. */
export type Recording = { title: string; lines: TerminalLine[] };

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

export type Picture = { src: StaticImageData; alt: string };

/** What a row produced, in a browser frame at `url`; with `before`, the frame switches between the two. */
export type Result = { url: string; before?: Picture; image: Picture };

/** One row of the showcase: a recording or the changed files beside the result. */
export type Session = {
  label: string;
  description: string;
  recording?: Recording;
  artifact?: Artifact;
  result: Result;
};
