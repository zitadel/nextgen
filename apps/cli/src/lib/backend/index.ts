/**
 * The backend: one service per noun of the Zitadel API, each bound to a project
 * and each returning immutable values. A command asks a service for what it
 * wants and never reaches the generated client, or its types, itself: every
 * type a command may need to name is exported from here, built on the API's own.
 *
 * Nothing in this module reads the disk, prints, escapes for a terminal, or
 * knows the command line or who agreed to what. It fails only with a
 * {@link BackendError}, and depends on nothing else under `lib/`.
 */
export type { Page, PageOptions } from "./api-service";
export {
  allowDestructive,
  createZitadelClient,
  pagedFunctions,
  REQUEST_TIMEOUT_MS,
  responseFailure,
  type ZitadelClient,
} from "./client";
export {
  BackendError,
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  type UnavailableReason,
} from "./errors";
export {
  AuthAttemptService,
  type AttemptFactor,
  type AttemptProof,
  type AttemptProofResult,
} from "./services/auth-attempt";
export { BrandingService, type BrandingRevision, type BrandingSummary } from "./services/branding";
export {
  ClaimService,
  type ClaimChallenge,
  type ClaimProgress,
  type ClaimStart,
  type CompletedClaim,
} from "./services/claim";
export {
  Deployment,
  DeploymentService,
  type DeploymentInput,
  type DeploymentPageQuery,
  type DeploymentQuery,
  type DeployToPrimaryRequest,
  type DeployToPrimaryResult,
  type ExtendPrimaryResult,
  type LiveOnResult,
  type RollbackInput,
  type RollbackPlan,
  type RollbackTarget,
} from "./services/deployment";
export {
  FlowService,
  type CreatedFlow,
  type FlowInput,
  type FlowPage,
  type FlowSummary,
  type FlowQuery,
  type FlowRecord,
} from "./services/flow";
export { IdpService, type IdpSummary } from "./services/idp";
export {
  Operation,
  OperationService,
  type ApiOperation,
  type ApiRequest,
  type ApiResponse,
  type OperationQuery,
  type Target,
} from "./services/operation";
export {
  Origin,
  Origins,
  OriginService,
  type OriginKind,
  type OriginRemoval,
} from "./services/origin";
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
} from "./services/policy";
export { PreviewService, type LivePreview, type PreviewPageQuery } from "./services/preview";
export {
  ProjectService,
  type CreatedProject,
  type Project,
  type ProjectInput,
} from "./services/project";
export {
  ReleaseService,
  type Release,
  type ReleaseInput,
  type ReleasePointer,
  type ReleasePointerKind,
  type ReleaseRecord,
} from "./services/release";
export {
  SchemaService,
  type CreatedSchema,
  type SchemaInput,
  type SchemaPage,
  type SchemaSummary,
  type SchemaQuery,
  type SchemaRecord,
} from "./services/schema";
export {
  type Credential,
  type IdentityLinks,
  type QueriedUser,
  type UserQuery,
  UserService,
} from "./services/user";
export {
  Variable,
  VariableRemoval,
  VariableService,
  VariableWrite,
  type Held,
  type Scalar,
  type VariableKind,
  type VariableState,
  type VariableValue,
  type VariableWritten,
} from "./services/variable";
