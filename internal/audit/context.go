package audit

import (
	"context"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

type contextKey struct{}

// actorSlotKey is a second context slot so ogen AuthGate can enrich a child
// ctx while net/http middleware still reads the parent. Collapsing to one key
// would drop that copy unless AuthGate reused the parent ctx.
type actorSlotKey struct{}

// ActorContext holds server-authoritative WHO/HOW dimensions for event emission (ADR 048 §5).
type ActorContext struct {
	ProjectID      string
	TeamID         *string
	ActorID        *string
	ActorType      *domain.EventActorType
	ClientID       string
	TokenID        string
	DelegationType string
	DelegationID   string
	Grantor        string
	Fingerprint    string
	SessionID      *string
	FlowID         *string
	RequestID      *string
	Authenticated  bool
	// Authorization records the path that authorized the request when it was
	// not a grant on the protected project (ADR 053 §8, ADR 075 §5). Every
	// event the request emits carries it in metadata.authorization.
	Authorization *domain.EventAuthorizationMetadata
}

// WithActorSlot plants a mutable actor slot on ctx so net/http middleware can
// observe AuthGate enrichment that happens inside ogen on a child context.
func WithActorSlot(ctx context.Context) context.Context {
	if _, ok := ctx.Value(actorSlotKey{}).(*ActorContext); ok {
		return ctx
	}
	return context.WithValue(ctx, actorSlotKey{}, &ActorContext{})
}

func ActorSlotFromContext(ctx context.Context) (*ActorContext, bool) {
	v, ok := ctx.Value(actorSlotKey{}).(*ActorContext)
	return v, ok && v != nil
}

// BindPublicRequest stamps project/flow/session onto the actor slot so Path A
// can emit request.api without a token (hosted login/flow). No-op when
// projectID is empty or there is no slot. Does not set Authenticated.
func BindPublicRequest(ctx context.Context, projectID, flowID, sessionID string) {
	if projectID == "" {
		return
	}
	slot, ok := ActorSlotFromContext(ctx)
	if !ok || slot == nil {
		return
	}
	slot.ProjectID = projectID
	if flowID != "" {
		id := flowID
		slot.FlowID = &id
	}
	if sessionID != "" {
		id := sessionID
		slot.SessionID = &id
	}
	if slot.RequestID == nil {
		if reqID, ok := middleware.GetRequestIDContext(ctx); ok && reqID != "" {
			slot.RequestID = &reqID
		}
	}
}

// MarkAuthorization records on the request's actor slot which path authorized
// it, after the security handler stamped the actor. Path A reads the slot
// directly; Path B events pick it up through actorFromContext. Without a slot
// (a call outside an HTTP request) there is no request to mark.
func MarkAuthorization(ctx context.Context, authorization domain.EventAuthorizationMetadata) {
	if slot, ok := ActorSlotFromContext(ctx); ok {
		slot.Authorization = &authorization
	}
}

// WithActorContext stores ActorContext on ctx and updates any actor slot.
func WithActorContext(ctx context.Context, ac ActorContext) context.Context {
	if slot, ok := ActorSlotFromContext(ctx); ok {
		*slot = ac
	}
	return context.WithValue(ctx, contextKey{}, ac)
}

func ActorFromContext(ctx context.Context) (ActorContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ActorContext)
	return v, ok
}

// actorFromContext prefers the value actor (AuthGate), then the mutable slot
// (BindPublicRequest / public login). RequestID always falls back to the HTTP
// middleware value so Path B events share the request's req_… even when no
// actor was stamped yet (POST /projects in-TX emits).
func actorFromContext(ctx context.Context) ActorContext {
	var ac ActorContext
	slot, hasSlot := ActorSlotFromContext(ctx)
	if v, ok := ActorFromContext(ctx); ok {
		ac = v
	} else if hasSlot && slot != nil {
		ac = *slot
	}
	// The authz gate marks the slot after the value actor was stamped, so a
	// mark only the slot carries still belongs to this request.
	if ac.Authorization == nil && hasSlot && slot != nil {
		ac.Authorization = slot.Authorization
	}
	if ac.RequestID == nil {
		if reqID, ok := middleware.GetRequestIDContext(ctx); ok && reqID != "" {
			ac.RequestID = &reqID
		}
	}
	return ac
}

// FromContext builds a domain.Event skeleton from ActorContext when present.
func FromContext(ctx context.Context, eventType domain.EventType, category domain.EventCategory) *domain.Event {
	ev := &domain.Event{
		EventType:      eventType,
		Category:       category,
		DelegationType: "direct",
		Payload:        json.RawMessage("{}"),
		Metadata:       json.RawMessage("{}"),
	}
	ac := actorFromContext(ctx)
	ev.ProjectID = ac.ProjectID
	ev.TeamID = ac.TeamID
	ev.ActorID = ac.ActorID
	ev.ActorType = ac.ActorType
	ev.ClientID = ac.ClientID
	ev.TokenID = ac.TokenID
	if ac.DelegationType != "" {
		ev.DelegationType = ac.DelegationType
	}
	ev.DelegationID = ac.DelegationID
	ev.Grantor = ac.Grantor
	ev.Fingerprint = ac.Fingerprint
	ev.SessionID = ac.SessionID
	ev.FlowID = ac.FlowID
	ev.RequestID = ac.RequestID
	if ac.Authorization != nil {
		if meta, err := events.MarshalPayload(domain.EventMetadata{Authorization: ac.Authorization}); err == nil {
			ev.Metadata = meta
		}
	}
	return ev
}

func WithEntity(ev *domain.Event, entityType, entityID string) *domain.Event {
	if entityType != "" {
		ev.EntityType = &entityType
	}
	if entityID != "" {
		ev.EntityID = &entityID
	}
	return ev
}

func WithPayload(ev *domain.Event, payload any) (*domain.Event, error) {
	raw, err := events.MarshalPayload(payload)
	if err != nil {
		return ev, err
	}
	ev.Payload = raw
	return ev, nil
}
