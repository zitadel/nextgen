import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Where an operation is written in the spec's source, which is where a person fixes it. */
export interface SourceLocation {
  /** Relative to the repository root, with forward slashes. */
  file: string;
  line: number;
}

/**
 * Finds the YAML file and line each `operationId` is defined on, so a failure
 * can be shown on that line of the pull request, and a link to it opens the
 * definition.
 */
export class OperationSources {
  private readonly locations = new Map<string, SourceLocation>();

  /**
   * @param directory - the OpenAPI source folder to scan.
   * @param root - the repository root, which the files are named relative to.
   */
  constructor(directory: string, root: string) {
    this.scan(directory, root);
  }

  private scan(directory: string, root: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "bundled") {
          this.scan(path, root);
        }
        continue;
      }
      if (!entry.name.endsWith(".yaml")) {
        continue;
      }
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, index) => {
          const id = /^\s*operationId:\s*(\S+)\s*$/.exec(text)?.[1];
          if (id !== undefined && !this.locations.has(id)) {
            this.locations.set(id, {
              file: relative(root, path).split("\\").join("/"),
              line: index + 1,
            });
          }
        });
    }
  }

  /** The definition of `operationId`, when the source has it. */
  find(operationId: string): SourceLocation | undefined {
    return this.locations.get(operationId);
  }
}
