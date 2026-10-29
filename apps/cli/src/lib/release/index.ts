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
  DEFAULT_TARGET,
  newestDeploymentTo,
  PROJECT_TARGETS,
  rollbackDeployment,
  rollbackOrigins,
  type Deployment,
} from "./deployment";
export { deployInitialRelease, type InitialDeployment } from "./initial-deploy";
export { worktreeIsDirty, headSha } from "./git";
export { runSteps, type PipelineMode, type Step, type StepContext } from "./pipeline";
export { validateStep } from "./steps/validate";
export { diffStep } from "./steps/diff";
export { originMatchesPattern, type ProjectOriginEntry } from "./origins";

/**
 * The arguments of a suggested publish. `deploy` refuses to run without `-m` when
 * no one can be asked for a message, which is every agent and every `--json`
 * run, so a suggested deploy carries one for the reader to fill in.
 */
export const DEPLOY_ARGS = "deploy -m '<what changed>'";
export { type ListedDeployment, listLiveDeployments, servesPrimary } from "./deployment";
