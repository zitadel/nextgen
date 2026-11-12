/** How regenerating a project's files at the new version ended, when it ran at all. */
export type Refresh = "done" | "issues" | "failed" | "planned" | "skipped";

/** The ways a refresh that ran can end. */
export type RefreshOutcome = Extract<Refresh, "done" | "issues" | "failed">;

/** Has the new release regenerate what it generates in one project. */
export interface Refresher {
  /**
   * Whether the project is one a refresh applies to.
   *
   * @returns `false` for a project with nothing to regenerate.
   */
  appliesTo(): Promise<boolean>;

  /**
   * Regenerates the project's files at a release, because only that release
   * knows what it generates. A run that reports issues still repaired what it could.
   *
   * @param version - The release to run.
   * @returns How it ended.
   */
  refresh(version: string): Promise<RefreshOutcome>;
}
