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

export {
  allowDestructive,
  createZitadelClient,
  isCancelled,
  type OperationName,
  pagedFunctions,
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
export { AuthAttemptService } from "./services/auth-attempt";
export { BrandingService } from "./services/branding";
export { ClaimService } from "./services/claim";
export { Deployment, DeploymentService, type DeployToPrimaryResult } from "./services/deployment";
export { FlowService } from "./services/flow";
export { IdpService } from "./services/idp";
export {
  type Invitation,
  invitationGrant,
  type InvitationRelation,
  invitationRole,
  InvitationService,
  type InvitationStatus,
  type InvitationType,
  UNACCEPTED_INVITATION_STATUSES,
} from "./services/invitation";
export { type ApiRequest, Operation, OperationService, type Target } from "./services/operation";
export { OriginService, Origins } from "./services/origin";
export { type PolicyEvaluation, PolicyService } from "./services/policy";
export { PreviewService } from "./services/preview";
export { type CreatedProject, ProjectService } from "./services/project";
export {
  type Release,
  type ReleaseInput,
  type ReleasePointer,
  type ReleasePointerKind,
  type ReleaseRecord,
  ReleaseService,
} from "./services/release";
export { SchemaService } from "./services/schema";
export { type Credential, type QueriedUser, type UserQuery, UserService } from "./services/user";
export {
  type Held,
  type Scalar,
  Variable,
  VariableRemoval,
  VariableService,
  VariableWrite,
} from "./services/variable";
