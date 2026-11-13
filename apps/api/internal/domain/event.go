package domain

import (
	"encoding/json"
	"time"
)

const PrefixEvent ResourcePrefix = "evt"

// EventCategory is the ADR 048 wide-event category.
type EventCategory string

const (
	EventCategoryRequest EventCategory = "request"
	EventCategoryAuth    EventCategory = "auth"
	EventCategorySession EventCategory = "session"
	EventCategoryAdmin   EventCategory = "admin"
	EventCategoryEntity  EventCategory = "entity"
	EventCategorySignal  EventCategory = "signal"
)

// EventCategories lists every category an event is stored under. A read that
// is split by category (events.ListEach) and names none reads each of these,
// so a category added above joins this list.
func EventCategories() []EventCategory {
	return []EventCategory{
		EventCategoryRequest,
		EventCategoryAuth,
		EventCategorySession,
		EventCategoryAdmin,
		EventCategoryEntity,
		EventCategorySignal,
	}
}

// HTTPStatusClass is the class of an HTTP response status, named by its
// first digit (RFC 9110 §15).
type HTTPStatusClass string

const (
	HTTPStatusClassInformational HTTPStatusClass = "1xx"
	HTTPStatusClassSuccessful    HTTPStatusClass = "2xx"
	HTTPStatusClassRedirection   HTTPStatusClass = "3xx"
	HTTPStatusClassClientError   HTTPStatusClass = "4xx"
	HTTPStatusClassServerError   HTTPStatusClass = "5xx"
)

// HTTPStatusClasses lists every class a request.api event is stored under. A
// read by operation names a class for each of its ranges and reads each of
// these when the list names none, so a class added above joins this list.
func HTTPStatusClasses() []HTTPStatusClass {
	return []HTTPStatusClass{
		HTTPStatusClassInformational,
		HTTPStatusClassSuccessful,
		HTTPStatusClassRedirection,
		HTTPStatusClassClientError,
		HTTPStatusClassServerError,
	}
}

// HTTPStatusClassOf is the class of status, and false for a status outside
// 100–599, which HTTP defines no class for.
func HTTPStatusClassOf(status int) (HTTPStatusClass, bool) {
	if status < 100 || status > 599 {
		return "", false
	}
	return HTTPStatusClasses()[status/100-1], true
}

// EventActorType is who triggered the event.
type EventActorType string

const (
	EventActorTypeHuman   EventActorType = "human"
	EventActorTypeService EventActorType = "service"
	EventActorTypeSystem  EventActorType = "system"
	EventActorTypeAgent   EventActorType = "agent"
)

// EventType is a semantic event name (dot-separated), e.g. user.created.
type EventType string

// Path A / Path B event types with live producers
// (see docs/design/api/events-catalog.md). Deferred types live only in the
// catalog Deferred section until follow-up issues land.
const (
	EventTypeRequestAPI EventType = "request.api"

	EventTypeProjectCreated EventType = "project.created"
	EventTypeProjectUpdated EventType = "project.updated"
	EventTypeProjectDeleted EventType = "project.deleted"

	EventTypeUserCreated      EventType = "user.created"
	EventTypeUserCreateFailed EventType = "user.create.failed"
	EventTypeUserUpdated      EventType = "user.updated"
	EventTypeUserDeleted      EventType = "user.deleted"

	EventTypeTeamCreated     EventType = "team.created"
	EventTypeTeamUpdated     EventType = "team.updated"
	EventTypeTeamDeactivated EventType = "team.deactivated"

	EventTypeAuthTokenIssued  EventType = "auth.token.issued"
	EventTypeAuthTokenRevoked EventType = "auth.token.revoked"

	EventTypeSessionEstablished EventType = "session.established"
	EventTypeSessionDeleted     EventType = "session.deleted"

	EventTypeSignupChallengeIssued   EventType = "flow.signup_challenge.issued"
	EventTypeSignupChallengeConsumed EventType = "flow.signup_challenge.consumed"
	EventTypeAuthAttemptCreated      EventType = "auth.attempt.created"
	EventTypeAuthAttemptHandedOff    EventType = "auth.attempt.handed_off"
	EventTypeAuthCheckFailed         EventType = "auth.check.failed"
	EventTypeAuthCheckSucceeded      EventType = "auth.check.succeeded"

	// The SSO callback's outcome, separate from auth.check.*: a succeeded
	// exchange is not a sign-in, since the identity may still match no account.
	// An authorization failure is the provider's error response, or a callback
	// with no code; an exchange failure is anything after a code arrived. A
	// callback refused before its exchange, on another connection's path or
	// with a foreign `iss`, follows the same split.
	EventTypeAuthSSOAuthorizationFailed EventType = "auth.sso.authorization.failed"
	EventTypeAuthSSOExchangeSucceeded   EventType = "auth.sso.exchange.succeeded"
	EventTypeAuthSSOExchangeFailed      EventType = "auth.sso.exchange.failed"

	EventTypeFlowdefCreated EventType = "flowdef.created"
	// Retired, no producer. Kept so stored rows decode.
	// TODO(grvijayan): remove both, their OpenAPI event types and the
	// gen_event_schemas entries once the rows have aged out of retention.
	EventTypeFlowdefUpdated EventType = "flowdef.updated"
	EventTypeFlowdefDeleted EventType = "flowdef.deleted"

	EventTypeSchemaCreated EventType = "schema.created"

	EventTypeBrandingCreated EventType = "branding.created"

	EventTypePolicyCreated EventType = "policy.created"
	EventTypePolicyUpdated EventType = "policy.updated"

	EventTypeReleaseCreated EventType = "release.created"
	EventTypeReleaseRevoked EventType = "release.revoked"

	EventTypeApplicationCreated EventType = "application.created"
	EventTypeApplicationUpdated EventType = "application.updated"

	EventTypeIDPCreated EventType = "idp.created"
	EventTypeIDPUpdated EventType = "idp.updated"

	EventTypeIDPIdentityLinkCreated EventType = "idp.identity_link.created"

	EventTypeDeploymentCreated EventType = "deployment.created"

	EventTypeOriginAdded   EventType = "origin.added"
	EventTypeOriginRemoved EventType = "origin.removed"

	EventTypeVariableSet     EventType = "variable.set"
	EventTypeVariableRemoved EventType = "variable.removed"

	EventTypePreviewRemoved EventType = "preview.removed"

	EventTypeAuthzGranted EventType = "authz.granted"
	EventTypeAuthzRevoked EventType = "authz.revoked"

	EventTypeInvitationCreated   EventType = "invitation.created"
	EventTypeInvitationAccepted  EventType = "invitation.accepted"
	EventTypeInvitationRejected  EventType = "invitation.rejected"
	EventTypeInvitationCancelled EventType = "invitation.cancelled"

	EventTypeAuthFactorPasswordSet     EventType = "auth.factor.password.set"
	EventTypeAuthFactorPasskeyEnrolled EventType = "auth.factor.passkey.enrolled"

	EventTypeWebhookCreated       EventType = "webhook.created"
	EventTypeWebhookUpdated       EventType = "webhook.updated"
	EventTypeWebhookDeleted       EventType = "webhook.deleted"
	EventTypeWebhookSecretRotated EventType = "webhook.secret_rotated"
)

// WrittenEventTypes is every event type the server writes: the Path A and
// Path B types of docs/design/api/events-catalog.md. A retired type is not in
// it, since nothing writes it any more. A webhook's filter is checked against
// it (ADR 090 §1). The catalog's producer test keeps it in step with the
// catalog.
func WrittenEventTypes() []EventType {
	return []EventType{
		EventTypeRequestAPI,
		EventTypeProjectCreated, EventTypeProjectUpdated, EventTypeProjectDeleted,
		EventTypeUserCreated, EventTypeUserCreateFailed, EventTypeUserUpdated, EventTypeUserDeleted,
		EventTypeTeamCreated, EventTypeTeamUpdated, EventTypeTeamDeactivated,
		EventTypeAuthTokenIssued, EventTypeAuthTokenRevoked,
		EventTypeSessionEstablished, EventTypeSessionDeleted,
		EventTypeSignupChallengeIssued, EventTypeSignupChallengeConsumed,
		EventTypeAuthAttemptCreated, EventTypeAuthAttemptHandedOff,
		EventTypeAuthCheckFailed, EventTypeAuthCheckSucceeded,
		EventTypeAuthSSOAuthorizationFailed, EventTypeAuthSSOExchangeSucceeded, EventTypeAuthSSOExchangeFailed,
		EventTypeFlowdefCreated,
		EventTypeSchemaCreated,
		EventTypeBrandingCreated,
		EventTypePolicyCreated, EventTypePolicyUpdated,
		EventTypeReleaseCreated, EventTypeReleaseRevoked,
		EventTypeIDPCreated, EventTypeIDPUpdated,
		EventTypeIDPIdentityLinkCreated,
		EventTypeDeploymentCreated,
		EventTypeOriginAdded, EventTypeOriginRemoved,
		EventTypeVariableSet, EventTypeVariableRemoved,
		EventTypePreviewRemoved,
		EventTypeAuthzGranted, EventTypeAuthzRevoked,
		EventTypeAuthFactorPasswordSet, EventTypeAuthFactorPasskeyEnrolled,
		EventTypeApplicationCreated, EventTypeApplicationUpdated,
		EventTypeInvitationCreated, EventTypeInvitationCancelled,
		EventTypeWebhookCreated, EventTypeWebhookUpdated, EventTypeWebhookDeleted, EventTypeWebhookSecretRotated,
	}
}

// Event is one append-only wide-event row (ADR 048).
type Event struct {
	ProjectID  string
	ID         string
	EventType  EventType
	Category   EventCategory
	OccurredAt time.Time
	CreatedAt  time.Time

	TeamID *string

	ActorID   *string
	ActorType *EventActorType

	EntityType *string
	EntityID   *string

	// UserID is the user the event concerns, whoever acted: the user a
	// session, a token, a sign-in check or a credential belongs to, and the
	// user a change was made to. Nil on an event that concerns no user.
	UserID *string

	ClientID       string
	TokenID        string
	DelegationType string
	DelegationID   string
	Grantor        string
	Fingerprint    string

	RequestID *string
	SessionID *string
	FlowID    *string

	// OperationID and StatusClass copy what a request.api event's payload
	// records, the operation and the class of the response status, into
	// columns GET /events reads them from by index
	// (RequestAPIPayload.Indexed). Nil on every other event. The operation is
	// stored with its class, as one key (events.OperationStatus).
	OperationID *string
	StatusClass *HTTPStatusClass

	Payload  json.RawMessage
	Metadata json.RawMessage

	// OccurredAtWait is an insert-only hint for Path A batching: dialects set
	// occurred_at = created_at - wait (DB clock or equivalent; Spanner, whose
	// created_at is the commit timestamp, subtracts it from the time of the
	// insert). Path A wait is time since HTTP request start so request.api
	// sorts first on request_id. Zero means Path B (occurred_at = created_at,
	// or the time of the insert on Spanner). Not a persisted column.
	OccurredAtWait time.Duration
}

// EventClientMetadata is Path A requestor context on events.metadata.client.
type EventClientMetadata struct {
	IP        string `json:"ip,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`
	Origin    string `json:"origin,omitempty"`
}

// EventMetadata is the events.metadata JSON object.
type EventMetadata struct {
	Client        *EventClientMetadata        `json:"client,omitempty"`
	Authorization *EventAuthorizationMetadata `json:"authorization,omitempty"`
}

// EventAuthorizationMetadata is events.metadata.authorization: the path that
// authorized the request, when it was not a grant on the protected project
// (ADR 053 §8, ADR 075 §5).
type EventAuthorizationMetadata struct {
	Path               string `json:"path"`
	ActorHomeProjectID string `json:"actor_home_project_id,omitempty"`
}

// EventAuthorizationPathPlatformOperator marks a request the platform operator
// relation authorized (ADR 075 §5).
const EventAuthorizationPathPlatformOperator = "platform_operator"

// EventField enumerates filterable/sortable Event columns.
type EventField uint8

const (
	EventFieldUnspecified EventField = iota
	EventFieldProjectID
	EventFieldID
	EventFieldEventType
	EventFieldCategory
	EventFieldOccurredAt
	EventFieldCreatedAt
	EventFieldTeamID
	EventFieldActorID
	EventFieldActorType
	EventFieldEntityType
	EventFieldEntityID
	EventFieldClientID
	EventFieldTokenID
	EventFieldFingerprint
	EventFieldRequestID
	EventFieldSessionID
	EventFieldFlowID
	EventFieldOperationStatus
	EventFieldStatusClass
	EventFieldUserID
)

func ErrEventNotFound() Error {
	return newError(PrefixEvent.ErrorCodePrefix("not_found"), "event: not found", nil, nil)
}

func ErrEventPermissionDenied() Error {
	return newError(PrefixEvent.ErrorCodePrefix("permission_denied"), "event: permission denied", nil, nil)
}

func ErrEventInvalid(details any, parent error) Error {
	return newError(PrefixEvent.ErrorCodePrefix("invalid"), "event: invalid", details, parent)
}
