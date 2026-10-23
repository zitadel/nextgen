package audit

import (
	"context"
	"encoding/json"
	"sync/atomic"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

type contextKey struct{}

// actorSlotKey is a second context slot so ogen AuthGate can enrich a child
// ctx while net/http middleware still reads the parent. Collapsing to one key
// would drop that copy unless AuthGate reused the parent ctx.
type actorSlotKey struct{}

// authorizationKey carries the request's authorization mark: a context value
// of its own, beside the actor slot and for the same reason (MarkAuthorization).
type authorizationKey struct{}

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

// authorizationMark holds the path that authorized a request when it was not
// a grant on the protected project (ADR 053 §8, ADR 075 §5).
type authorizationMark struct {
	metadata atomic.Pointer[domain.EventAuthorizationMetadata]
}

// WithActorSlot plants a mutable actor slot on ctx so net/http middleware can
// observe AuthGate enrichment that happens inside ogen on a child context. The
// request's authorization mark goes beside it, for the same reason.
func WithActorSlot(ctx context.Context) context.Context {
	if _, ok := ctx.Value(actorSlotKey{}).(*ActorContext); ok {
		return ctx
	}
	return context.WithValue(withAuthorizationMark(ctx), actorSlotKey{}, &ActorContext{})
}

// withAuthorizationMark plants the request's authorization mark, unless ctx
// already carries one.
func withAuthorizationMark(ctx context.Context) context.Context {
	if _, ok := ctx.Value(authorizationKey{}).(*authorizationMark); ok {
		return ctx
	}
	return context.WithValue(ctx, authorizationKey{}, &authorizationMark{})
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

// MarkAuthorization records which path authorized the request, after the
// security handler stamped its actor. Every event the request emits from then
// on, Path A and Path B alike, carries it. Outside a request no mark is
// planted, and there is nothing to mark.
func MarkAuthorization(ctx context.Context, authorization domain.EventAuthorizationMetadata) {
	if mark, ok := ctx.Value(authorizationKey{}).(*authorizationMark); ok {
		mark.metadata.Store(&authorization)
	}
}

// AuthorizationFromContext is the path that authorized the request, or nil
// when nothing marked it: an ordinary grant, or no authorization at all.
func AuthorizationFromContext(ctx context.Context) *domain.EventAuthorizationMetadata {
	if mark, ok := ctx.Value(authorizationKey{}).(*authorizationMark); ok {
		return mark.metadata.Load()
	}
	return nil
}

// WithActorContext stores ActorContext on ctx and updates any actor slot. A
// server without the request event middleware has planted no slot, and so no
// authorization mark: stamping the actor plants one, so the authz gate can
// still mark the request.
func WithActorContext(ctx context.Context, ac ActorContext) context.Context {
	if slot, ok := ActorSlotFromContext(ctx); ok {
		*slot = ac
	}
	return context.WithValue(withAuthorizationMark(ctx), contextKey{}, ac)
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
	if v, ok := ActorFromContext(ctx); ok {
		ac = v
	} else if slot, ok := ActorSlotFromContext(ctx); ok && slot != nil {
		ac = *slot
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
	if authorization := AuthorizationFromContext(ctx); authorization != nil {
		if meta, err := events.MarshalPayload(domain.EventMetadata{Authorization: authorization}); err == nil {
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
