package audit_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

type insertEventCapture struct {
	called int
	last   *domain.Event
	err    error
}

func (c *insertEventCapture) InsertEvent(_ context.Context, event *domain.Event) error {
	c.called++
	c.last = event
	return c.err
}

func TestInsert_NoopsEmptyProjectID(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 0, cap.called)
}

func TestInsert_CallsInsertEvent(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev.ProjectID = "proj_1"
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 1, cap.called)
	require.Equal(t, ev, cap.last)
}

func TestEmit_BuildsAndInserts(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	require.NoError(t, audit.Emit(t.Context(), cap, audit.EmitSpec{
		Type:       domain.EventTypeUserCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  "proj_1",
		EntityType: "user",
		EntityID:   "user_1",
		Payload:    domain.UserCreatedPayload{},
	}))
	require.Equal(t, 1, cap.called)
	require.Equal(t, "proj_1", cap.last.ProjectID)
	require.Equal(t, domain.EventTypeUserCreated, cap.last.EventType)
	require.NotNil(t, cap.last.EntityID)
	require.Equal(t, "user_1", *cap.last.EntityID)
}

// A request that names no flow (the handoff exchange) still writes into the
// flow its caller names; an empty override leaves the request's own.
// The user an event concerns is the spec's, whoever the request's actor is.
// An event that concerns no user has none, not an empty one.
func TestEmit_NamesTheUserTheEventConcerns(t *testing.T) {
	t.Parallel()
	admin := "user_admin"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{ProjectID: "proj_1", ActorID: &admin, Authenticated: true})

	cap := &insertEventCapture{}
	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:       domain.EventTypeSessionDeleted,
		Category:   domain.EventCategorySession,
		ProjectID:  "proj_1",
		EntityType: "session",
		EntityID:   "sess_1",
		UserID:     "user_1",
	}))
	require.NotNil(t, cap.last.UserID)
	require.Equal(t, "user_1", *cap.last.UserID)
	require.NotNil(t, cap.last.ActorID)
	require.Equal(t, admin, *cap.last.ActorID, "the actor stays the request's")

	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:       domain.EventTypeSessionDeleted,
		Category:   domain.EventCategorySession,
		ProjectID:  "proj_1",
		EntityType: "session",
		EntityID:   "sess_2",
	}))
	require.Nil(t, cap.last.UserID)
}

// No emitter passes a flow or a chain: an event carries the ones its request
// bound, from the moment it bound them.
func TestEmit_CarriesTheFlowAndTheChainTheRequestBound(t *testing.T) {
	t.Parallel()
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{ProjectID: "proj_1"})
	emit := func() *domain.Event {
		cap := &insertEventCapture{}
		require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
			Type:      domain.EventTypeSessionEstablished,
			Category:  domain.EventCategorySession,
			ProjectID: "proj_1",
			Payload:   domain.SessionEstablishedPayload{},
		}))
		return cap.last
	}
	before := emit()
	require.Nil(t, before.FlowID)
	require.Nil(t, before.CorrelationID)

	audit.BindFlow(ctx, "flow_attempt")
	audit.JoinCorrelation(ctx, "chain_attempt")
	after := emit()
	require.NotNil(t, after.FlowID)
	require.Equal(t, "flow_attempt", *after.FlowID)
	require.NotNil(t, after.CorrelationID)
	require.Equal(t, "chain_attempt", *after.CorrelationID)
}

func TestEmit_CopiesRequestIDFromMiddleware(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ctx := middleware.WithRequestIDContext(t.Context(), "req_api")
	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:       domain.EventTypeProjectCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  "proj_1",
		EntityType: "project",
		EntityID:   "proj_1",
		Payload:    domain.ProjectPayload{Name: "Acme"},
	}))
	require.Equal(t, 1, cap.called)
	require.NotNil(t, cap.last.RequestID)
	require.Equal(t, "req_api", *cap.last.RequestID)
	require.Equal(t, json.RawMessage("{}"), cap.last.Metadata)
}

// TestEmit_LandsInTheChangedProject pins ADR 053 §8: a session acting on
// another project records the change in that project, not in its own.
func TestEmit_LandsInTheChangedProject(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	actor := "user_op"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{ProjectID: "proj_platform", ActorID: &actor})
	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:       domain.EventTypeProjectUpdated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  "proj_customer",
		EntityType: "project",
		EntityID:   "proj_customer",
		Payload:    domain.ProjectUpdatedPayload{},
	}))
	require.Equal(t, 1, cap.called)
	require.Equal(t, "proj_customer", cap.last.ProjectID)
	require.Equal(t, &actor, cap.last.ActorID)
}
