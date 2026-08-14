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
	EventTypeUserDeleted      EventType = "user.deleted"

	EventTypeTeamCreated     EventType = "team.created"
	EventTypeTeamUpdated     EventType = "team.updated"
	EventTypeTeamDeactivated EventType = "team.deactivated"

	EventTypeAuthTokenIssued  EventType = "auth.token.issued"
	EventTypeAuthTokenRevoked EventType = "auth.token.revoked"

	EventTypeSessionEstablished EventType = "session.established"
	EventTypeSessionDeleted     EventType = "session.deleted"

	EventTypeAuthAttemptCreated   EventType = "auth.attempt.created"
	EventTypeAuthAttemptHandedOff EventType = "auth.attempt.handed_off"
	EventTypeAuthCheckFailed      EventType = "auth.check.failed"
	EventTypeAuthCheckSucceeded   EventType = "auth.check.succeeded"

	EventTypeFlowdefCreated EventType = "flowdef.created"
	EventTypeFlowdefUpdated EventType = "flowdef.updated"
	EventTypeFlowdefDeleted EventType = "flowdef.deleted"

	EventTypeSchemaCreated EventType = "schema.created"

	EventTypeBrandingCreated EventType = "branding.created"

	EventTypeAuthzGranted EventType = "authz.granted"

	EventTypeAuthFactorPasswordSet     EventType = "auth.factor.password.set"
	EventTypeAuthFactorPasskeyEnrolled EventType = "auth.factor.passkey.enrolled"
)

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

	ClientID       string
	TokenID        string
	DelegationType string
	DelegationID   string
	Grantor        string
	Fingerprint    string

	RequestID *string
	SessionID *string
	FlowID    *string

	Payload  json.RawMessage
	Metadata json.RawMessage

	// OccurredAtWait is an insert-only hint for Path A batching: dialects set
	// occurred_at = created_at - wait (DB clock or equivalent). Path A wait is
	// time since HTTP request start so request.api sorts first on request_id.
	// Zero means Path B (occurred_at = created_at). Not a persisted column.
	OccurredAtWait time.Duration
}

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
