/**
 * The publish pipeline: build a release bundle from `.zitadel/`, run the steps
 * that prepare and check it, create the release, and deploy it. Each noun of the
 * backend is a service bound to one project — {@link ReleaseService},
 * {@link DeploymentService}, {@link OriginService}. `deploy` and `preview` are thin compositions of these.
 */
export {
  ReleaseService,
  type ConfigurationBundle,
  type Release,
  type ReleaseSource,
} from "./release-service";
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
export {
  Variable,
  VariableService,
  type VariableState,
  type VariableWrite,
} from "./variable-service";
export { BrandingService } from "./branding-service";
export { PolicyService, type PolicyEvaluation, type PolicyQuery } from "./policy-service";
export {
  EnvironmentService,
  type BindRequest,
  type EnvironmentBinding,
  type EnvironmentFiles,
  type EnvironmentLocation,
  type PlatformVariable,
  type PlatformVariables,
} from "./environment-service";
export {
  OriginService,
  type OriginKind,
  type OriginRemoval,
  type ProjectOriginEntry,
} from "./origin-service";

/**
 * The arguments of a suggested publish. A non-interactive `deploy` with no
 * message to fall back on refuses to run without `-m`, so a suggested deploy
 * carries one for the reader to fill in.
 */
export const DEPLOY_ARGS = "deploy -m '<what changed>'";
