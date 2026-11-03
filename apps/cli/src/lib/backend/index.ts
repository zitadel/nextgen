/**
 * The publish pipeline: build a release bundle from `.zitadel/`, run the steps
 * that prepare and check it, create the release, and deploy it. Each noun of the
 * backend is a service bound to one project — {@link ReleaseService},
 * {@link DeploymentService}, {@link OriginService}. `deploy` and `preview` are thin compositions of these.
 */
export { buildBundle, type BuiltBundle, type ConfigurationBundle } from "./bundle";
export { ReleaseService, type Release, type ReleaseSource } from "./release-service";
export {
  DeploymentService,
  type DeployInput,
  type Deployment,
  type DeploymentPageQuery,
  type DeploymentQuery,
  type DeployTargets,
  type RollbackOptions,
  type RolledBackDeployment,
} from "./deployment-service";
export {
  ProjectService,
  type CreatedProject,
  type CreateProjectInput,
  type Project,
} from "./project-service";
export { PreviewService, type PreviewPageQuery } from "./preview-service";
export { VariableService, type VariableKinds, type VariableWrite } from "./variable-service";
export { OriginService, type OriginKind, type ProjectOriginEntry } from "./origin-service";
export { worktreeIsDirty, headSha } from "./git";
export { deployMessage, MESSAGE_MAX_LENGTH, messageTooLong } from "./message";
export { runSteps, type PipelineMode, type Step, type StepContext } from "./pipeline";
export { validateStep } from "./steps/validate";
export { diffStep } from "./steps/diff";

/**
 * The arguments of a suggested publish. A non-interactive `deploy` with no
 * message to fall back on refuses to run without `-m`, so a suggested deploy
 * carries one for the reader to fill in.
 */
export const DEPLOY_ARGS = "deploy -m '<what changed>'";
