/**
 * The backend: one service per noun of the Zitadel API, each bound to a project
 * and each returning immutable values. A command asks a service for what it
 * wants and never reaches the generated client itself.
 *
 * Nothing in this module reads the disk, prints, or knows the command line. It
 * depends on the API client, the consent a destructive call needs, and the
 * error type, and on nothing else under `lib/`.
 */
export { BrandingService } from "./branding-service";
export {
  Deployment,
  DeploymentService,
  type DeployToPrimaryRequest,
  type DeployToPrimaryResult,
  type RollbackPlan,
  type RollbackTarget,
} from "./deployment-service";
export {
  EnvironmentService,
  type BindRequest,
  type EnvironmentBinding,
  type EnvironmentFiles,
  type EnvironmentLocation,
  type PlatformVariable,
  type PlatformVariables,
} from "./environment-service";
export { Origin, OriginService, type OriginRemoval } from "./origin-service";
export { PolicyService } from "./policy-service";
export { PreviewService } from "./preview-service";
export { ProjectService } from "./project-service";
export {
  ReleaseService,
  type ConfigurationBundle,
  type Release,
  type ReleaseSource,
} from "./release-service";
export {
  Variable,
  VariableService,
  type VariableKind,
  type VariableState,
  type VariableValue,
} from "./variable-service";
