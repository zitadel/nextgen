/**
 * The backend: one service per noun of the Zitadel API, each bound to a project
 * and each returning immutable values. A command asks a service for what it
 * wants and never reaches the generated client, or its types, itself: every
 * type a command may need to name is exported from here, built on the API's own.
 *
 * Nothing in this module reads the disk, prints, or knows the command line or
 * who agreed to what. It fails only with a {@link BackendError}, and depends on
 * nothing else under `lib/` but the terminal-text escaper.
 */
export { ApiService, type Page } from "./api-service";
export {
  allowDestructive,
  createZitadelClient,
  pagedFunctions,
  REQUEST_TIMEOUT_MS,
  responseFailure,
  sanitizeResponse,
  type SanitizeOptions,
  type ZitadelClient,
  type ZitadelClientOptions,
} from "./client";
export {
  BackendError,
  type BackendErrorOptions,
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
  UnavailableError,
  type UnavailableErrorOptions,
  type UnavailableReason,
} from "./errors";
export {
  AuthAttemptService,
  type AttemptFactor,
  type AttemptProof,
  type AttemptProofResult,
} from "./auth-attempt-service";
export { BrandingService, type BrandingRevision, type BrandingSummary } from "./branding-service";
export {
  ClaimService,
  type ClaimChallenge,
  type ClaimProgress,
  type ClaimStart,
  type CompletedClaim,
} from "./claim-service";
export {
  Deployment,
  DeploymentService,
  type DeploymentInput,
  type DeploymentPageQuery,
  type DeploymentQuery,
  type DeployToPrimaryRequest,
  type DeployToPrimaryResult,
  type LiveOnResult,
  type RollbackInput,
  type RollbackPlan,
  type RollbackTarget,
} from "./deployment-service";
export {
  FlowService,
  type CreatedFlow,
  type FlowInput,
  type FlowPage,
  type FlowQuery,
  type FlowRecord,
} from "./flow-service";
export {
  Origin,
  Origins,
  OriginService,
  type OriginKind,
  type OriginRemoval,
} from "./origin-service";
export {
  PolicyService,
  type Policy,
  type PolicyDecision,
  type PolicyEvaluation,
  type PolicyPage,
  type PolicyQuery,
  type PolicyRecord,
  type PolicyInput,
  type PolicyRevision,
  type PublishedPolicy,
} from "./policy-service";
export { PreviewService, type LivePreview, type PreviewPageQuery } from "./preview-service";
export {
  ProjectService,
  type CreatedProject,
  type Project,
  type ProjectInput,
} from "./project-service";
export {
  ReleaseService,
  type Release,
  type ReleaseInput,
  type ReleasePointer,
  type ReleasePointerKind,
  type ReleaseRecord,
} from "./release-service";
export {
  SchemaService,
  type CreatedSchema,
  type SchemaInput,
  type SchemaPage,
  type SchemaQuery,
  type SchemaRecord,
} from "./schema-service";
export { UserService } from "./user-service";
export {
  Variable,
  VariableService,
  type VariableKind,
  type VariableState,
  type VariableValue,
  type VariableWrite,
} from "./variable-service";
