export type FileOp =
  | { kind: "mkdir"; path: string; mode?: number }
  | { kind: "write"; path: string; mode?: number; contents: string }
  | { kind: "append"; path: string; contents: string; ifMissing?: string }
  | { kind: "merge-env"; path: string; entries: Record<string, string> }
  | { kind: "merge-json"; path: string; patch: Record<string, unknown> }
  | { kind: "append-gitignore"; entries: string[] }
  | { kind: "add-dep"; name: string; version: string; dev?: boolean };

export type ScaffoldPlan = {
  ops: FileOp[];
  summary: { title: string; detail: string }[];
};

export type ScaffoldResult = {
  dryRun: boolean;
  filesWritten: string[];
  filesSkipped: string[];
  depsAdded: string[];
};
