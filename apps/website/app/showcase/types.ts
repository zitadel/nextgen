import type { StaticImageData } from "next/image";

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

export type Picture = { src: StaticImageData; alt: string };

/** What a row produced, in a browser frame at `url`; with `before`, the frame switches between the two. */
export type Result = { url: string; before?: Picture; image: Picture };

/** One row of the showcase: what setup wrote, or the changed files, beside the result. */
export type Session = {
  label: string;
  description: string;
  scaffold?: Scaffold;
  artifact?: Artifact;
  result: Result;
};
