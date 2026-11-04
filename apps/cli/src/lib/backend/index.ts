/**
 * The backend: one service per noun of the Zitadel API, each bound to a project
 * and each returning immutable values. A command asks a service for what it
 * wants and never reaches the generated client itself.
 *
 * Nothing in this module reads the disk, prints, or knows the command line. It
 * depends on the API client, the consent a destructive call needs, and the
 * error type, and on nothing else under `lib/`.
 */
export { BrandingService, type BrandingRevision, type BrandingSummary } from "./branding-service";
export {
  DeploymentService,
  type DeployInput,
  Deployment,
  type DeploymentDetail,
  type DeploymentHistory,
  type DeploymentPageQuery,
  type DeploymentQuery,
  type DeployTargets,
  type Publication,
  type PublishRequest,
  type RollbackPlan,
  type RollbackTarget,
  type RollbackOptions,
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
export {
  Origin,
  OriginService,
  type OriginKind,
  type OriginRemoval,
} from "./origin-service";
export {
  PolicyService,
  type PolicyDecision,
  type PolicyEvaluation,
  type PolicyPage,
  type PolicyQuery,
  type PolicyRecord,
  type PolicyRevision,
  type PolicySummary,
} from "./policy-service";
export {
  PreviewService,
  type LivePreview,
  type PreviewList,
  type PreviewPageQuery,
} from "./preview-service";
export {
  ProjectService,
  type CreatedProject,
  type CreateProjectInput,
  type Project,
} from "./project-service";
export {
  ReleaseService,
  type ConfigurationBundle,
  type Release,
  type ReleaseRecord,
  type ReleaseSource,
} from "./release-service";
export {
  Variable,
  VariableService,
  type VariableKind,
  type VariableState,
  type VariableValue,
  type VariableWrite,
} from "./variable-service";
