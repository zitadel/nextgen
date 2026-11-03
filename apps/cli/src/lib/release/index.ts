/**
 * The publish pipeline: build a release bundle from `.zitadel/`, run the steps
 * that prepare and check it, create the release, and deploy it. `deploy` and
 * (later) `preview` are thin compositions of these.
 */
export { buildBundle, type BuiltBundle, type ConfigurationBundle } from "./bundle";
export {
  createReleaseFromBundle,
  revokeRelease,
  type Release,
  type ReleaseSource,
} from "./release";
export {
  createDeployment,
  rollbackDeployment,
  type Deployment,
  type DeployTargets,
} from "./deployment";
export { deployInitialRelease, type InitialDeployment } from "./initial-deploy";
export { worktreeIsDirty, headSha } from "./git";
export { deployMessage, messageFlag } from "./message";
export { runSteps, type PipelineMode, type Step, type StepContext } from "./pipeline";
export { validateStep } from "./steps/validate";
export { diffStep } from "./steps/diff";
export { originMatchesPattern, type ProjectOriginEntry } from "./origins";

/**
 * The arguments of a suggested publish. A non-interactive `deploy` with no
 * message to fall back on refuses to run without `-m`, so a suggested deploy
 * carries one for the reader to fill in.
 */
export const DEPLOY_ARGS = "deploy -m '<what changed>'";
export { servesPrimary } from "./deployment";
