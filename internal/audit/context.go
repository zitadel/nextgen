package audit

import (
	"context"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

type contextKey struct{}
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
}

// WithActorSlot plants a mutable actor slot on ctx so net/http middleware can
// observe AuthGate enrichment that happens inside ogen on a child context.
func WithActorSlot(ctx context.Context) context.Context {
	if _, ok := ctx.Value(actorSlotKey{}).(*ActorContext); ok {
		return ctx
	}
	return context.WithValue(ctx, actorSlotKey{}, &ActorContext{})
}

// ActorSlotFromContext returns the mutable slot when present.
func ActorSlotFromContext(ctx context.Context) (*ActorContext, bool) {
	v, ok := ctx.Value(actorSlotKey{}).(*ActorContext)
	return v, ok && v != nil
}

// WithActorContext stores ActorContext on ctx and updates any actor slot.
func WithActorContext(ctx context.Context, ac ActorContext) context.Context {
	if slot, ok := ActorSlotFromContext(ctx); ok {
		*slot = ac
	}
	return context.WithValue(ctx, contextKey{}, ac)
}

// ActorFromContext returns ActorContext when present.
func ActorFromContext(ctx context.Context) (ActorContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ActorContext)
	return v, ok
}

// FromContext builds a domain.Event skeleton from actor + correlation context.
func FromContext(ctx context.Context, eventType domain.EventType, category domain.EventCategory) *domain.Event {
	ev := &domain.Event{
		EventType:      eventType,
		Category:       category,
		DelegationType: "direct",
		Payload:        json.RawMessage("{}"),
		Metadata:       json.RawMessage("{}"),
	}
	if ac, ok := ActorFromContext(ctx); ok {
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
	}
	return ev
}

// WithEntity sets entity_type / entity_id on the event.
func WithEntity(ev *domain.Event, entityType, entityID string) *domain.Event {
	if entityType != "" {
		ev.EntityType = &entityType
	}
	if entityID != "" {
		ev.EntityID = &entityID
	}
	return ev
}

// WithPayload marshals a typed payload onto the event.
func WithPayload(ev *domain.Event, payload any) (*domain.Event, error) {
	raw, err := events.MarshalPayload(payload)
	if err != nil {
		return ev, err
	}
	ev.Payload = raw
	return ev, nil
}

// NewSystemEvent builds an event for background/system actors (no request context).
func NewSystemEvent(projectID string, eventType domain.EventType, category domain.EventCategory) *domain.Event {
	actorType := domain.EventActorTypeSystem
	return &domain.Event{
		ProjectID:      projectID,
		EventType:      eventType,
		Category:       category,
		ActorType:      &actorType,
		DelegationType: "direct",
		Payload:        json.RawMessage("{}"),
		Metadata:       json.RawMessage("{}"),
	}
}
