/**
 * What a login flow edit reports back.
 */

/**
 * A region an edit left alone because it was changed by hand.
 */
export type SkippedRegion = Readonly<{
  /**
   * The step that was left alone, such as `sso-conflict`.
   */
  step: string;
  /**
   * Where in the file, such as `steps.sso-conflict`.
   */
  region: string;
  /**
   * Why it was left alone.
   */
  reason: "hand-edited";
}>;
