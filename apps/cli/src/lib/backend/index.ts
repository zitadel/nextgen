/**
 * The backend: one service per noun of the Zitadel API, each bound to a project
 * and each returning immutable values. A command asks a service for what it
 * wants and never reaches the generated client itself.
 *
 * Nothing in this module reads the disk, prints, or knows the command line. It
 * depends on the API client, the consent a destructive call needs, and the
 * error type, and on nothing else under `lib/`.
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
