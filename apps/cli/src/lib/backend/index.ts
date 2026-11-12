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
  isCancelled,
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
  type AttemptFactor,
  type AttemptProof,
  type AttemptProofResult,
  AuthAttemptService,
} from "./services/auth-attempt";
export { type BrandingRevision, BrandingService, type BrandingSummary } from "./services/branding";
export {
  type ClaimChallenge,
  type ClaimProgress,
  ClaimService,
  type ClaimStart,
  type CompletedClaim,
} from "./services/claim";
export {
  Deployment,
  type DeploymentInput,
  type DeploymentPageQuery,
  type DeploymentQuery,
  DeploymentService,
  type DeployToPrimaryRequest,
  type DeployToPrimaryResult,
  type ExtendPrimaryResult,
  type LiveOnResult,
  type RollbackInput,
  type RollbackPlan,
  type RollbackTarget,
} from "./services/deployment";
export {
  type CreatedFlow,
  type FlowInput,
  type FlowPage,
  type FlowQuery,
  type FlowRecord,
  FlowService,
  type FlowSummary,
} from "./services/flow";
export { IdpService, type IdpSummary } from "./services/idp";
export {
  type CreatedInvitation,
  type Invitation,
  type InvitationInput,
  type InvitationPageQuery,
  type InvitationRelation,
  invitationRole,
  InvitationService,
  type InvitationStatus,
  type InvitationType,
} from "./services/invitation";
export {
  type ApiOperation,
  type ApiRequest,
  type ApiResponse,
  Operation,
  type OperationQuery,
  OperationService,
  type Target,
} from "./services/operation";
export {
  Origin,
  type OriginKind,
  type OriginRemoval,
  OriginService,
  Origins,
} from "./services/origin";
export {
  type Policy,
  type PolicyDecision,
  type PolicyEvaluation,
  type PolicyInput,
  type PolicyPage,
  type PolicyQuery,
  type PolicyRecord,
  type PolicyRevision,
  PolicyService,
  type PublishedPolicy,
} from "./services/policy";
export { type LivePreview, type PreviewPageQuery, PreviewService } from "./services/preview";
export {
  type CreatedProject,
  type Project,
  type ProjectInput,
  ProjectService,
} from "./services/project";
export {
  type Release,
  type ReleaseInput,
  type ReleasePointer,
  type ReleasePointerKind,
  type ReleaseRecord,
  ReleaseService,
} from "./services/release";
export {
  type CreatedSchema,
  type SchemaInput,
  type SchemaPage,
  type SchemaQuery,
  type SchemaRecord,
  SchemaService,
  type SchemaSummary,
} from "./services/schema";
export {
  type Credential,
  type IdentityLinks,
  type QueriedUser,
  type UserQuery,
  UserService,
} from "./services/user";
export {
  type Held,
  type Scalar,
  Variable,
  type VariableKind,
  VariableRemoval,
  VariableService,
  type VariableState,
  type VariableValue,
  VariableWrite,
  type VariableWritten,
} from "./services/variable";
