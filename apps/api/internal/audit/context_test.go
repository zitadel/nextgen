package audit

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestFromContext_Empty(t *testing.T) {
	ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	assert.Equal(t, domain.EventTypeUserCreated, ev.EventType)
	assert.Equal(t, domain.EventCategoryEntity, ev.Category)
	assert.Equal(t, "direct", ev.DelegationType)
	assert.Empty(t, ev.ProjectID)
	assert.Equal(t, json.RawMessage("{}"), ev.Metadata)
}

func TestFromContext_WithActor(t *testing.T) {
	actorID := "user_1"
	actorType := domain.EventActorTypeHuman
	reqID := "req_abc"
	ctx := WithActorContext(t.Context(), ActorContext{
		ProjectID:     "proj_1",
		ActorID:       &actorID,
		ActorType:     &actorType,
		TokenID:       "tkn_1",
		ClientID:      "app_1",
		RequestID:     &reqID,
		Authenticated: true,
	})
	ev := FromContext(ctx, domain.EventTypeUserCreated, domain.EventCategoryEntity)
	assert.Equal(t, "proj_1", ev.ProjectID)
	require.NotNil(t, ev.ActorID)
	assert.Equal(t, "user_1", *ev.ActorID)
	assert.Equal(t, "tkn_1", ev.TokenID)
	assert.Equal(t, "app_1", ev.ClientID)
	require.NotNil(t, ev.RequestID)
	assert.Equal(t, "req_abc", *ev.RequestID)
}

// Path B Emit reads FromContext. Public login/flow only stamps the mutable
// slot (BindPublicRequest); the value actor context stays empty.
func TestFromContext_ReadsActorSlot(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	ctx = middleware.WithRequestIDContext(ctx, "req_flow")
	BindPublicRequest(ctx, "proj_1", "flow_1", "sess_1")

	ev := FromContext(ctx, domain.EventTypeUserCreated, domain.EventCategoryEntity)
	assert.Equal(t, "proj_1", ev.ProjectID)
	require.NotNil(t, ev.RequestID)
	assert.Equal(t, "req_flow", *ev.RequestID)
	require.NotNil(t, ev.FlowID)
	assert.Equal(t, "flow_1", *ev.FlowID)
	require.NotNil(t, ev.SessionID)
	assert.Equal(t, "sess_1", *ev.SessionID)
}

// POST /projects has no AuthGate and stamps the slot only after create.
// In-TX Path B (project.created, schema.created, …) still needs request_id
// from the HTTP middleware value on ctx.
func TestFromContext_FillsRequestIDFromMiddleware(t *testing.T) {
	ctx := middleware.WithRequestIDContext(t.Context(), "req_create")
	ev := FromContext(ctx, domain.EventTypeProjectCreated, domain.EventCategoryEntity)
	require.NotNil(t, ev.RequestID)
	assert.Equal(t, "req_create", *ev.RequestID)
	assert.Empty(t, ev.ProjectID)
}

func TestFromContext_FillsRequestIDWhenActorOmitsIt(t *testing.T) {
	ctx := middleware.WithRequestIDContext(t.Context(), "req_mw")
	ctx = WithActorContext(ctx, ActorContext{ProjectID: "proj_1"})
	ev := FromContext(ctx, domain.EventTypeUserCreated, domain.EventCategoryEntity)
	assert.Equal(t, "proj_1", ev.ProjectID)
	require.NotNil(t, ev.RequestID)
	assert.Equal(t, "req_mw", *ev.RequestID)
}

func TestBindPublicRequest_StampsSlot(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	ctx = middleware.WithRequestIDContext(ctx, "req_flow")
	BindPublicRequest(ctx, "proj_1", "flow_1", "sess_1")

	slot, ok := ActorSlotFromContext(ctx)
	require.True(t, ok)
	assert.Equal(t, "proj_1", slot.ProjectID)
	assert.Equal(t, "flow_1", middleware.CorrelationFromContext(ctx).Flow())
	require.NotNil(t, slot.SessionID)
	assert.Equal(t, "sess_1", *slot.SessionID)
	require.NotNil(t, slot.RequestID)
	assert.Equal(t, "req_flow", *slot.RequestID)
	assert.False(t, slot.Authenticated)
}

func TestBindPublicRequest_EmptyProjectIsNoop(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	BindPublicRequest(ctx, "", "flow_1", "sess_1")

	slot, ok := ActorSlotFromContext(ctx)
	require.True(t, ok)
	assert.Empty(t, slot.ProjectID)
	assert.Empty(t, middleware.CorrelationFromContext(ctx).Flow())
	assert.Nil(t, slot.SessionID)
}

func TestBindPublicRequest_NoSlotIsNoop(t *testing.T) {
	BindPublicRequest(t.Context(), "proj_1", "flow_1", "sess_1")
}

func TestBindFlow_StampsOnlyTheFlowOfARequestWithNone(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	slot, ok := ActorSlotFromContext(ctx)
	require.True(t, ok)
	slot.ProjectID = "proj_1"
	correlation := middleware.CorrelationFromContext(ctx)

	BindFlow(ctx, "")
	assert.Empty(t, correlation.Flow())

	BindFlow(ctx, "flow_1")
	assert.Equal(t, "flow_1", correlation.Flow())
	assert.Equal(t, "proj_1", slot.ProjectID)
	assert.Nil(t, slot.SessionID)

	// The flow a request names itself stays.
	BindFlow(ctx, "flow_2")
	assert.Equal(t, "flow_1", correlation.Flow())

	BindFlow(t.Context(), "flow_1") // outside a request: a no-op
}

// The security handler stamps the actor on a context of its own, a copy. A
// flow and a chain the handler learns afterwards still reach the domain
// events it writes, as they reach the request event: both read the request's
// one correlation.
func TestFromContext_AuthenticatedRequestCarriesWhatItBoundLater(t *testing.T) {
	request := WithActorSlot(middleware.WithCorrelation(t.Context()))
	handler := WithActorContext(request, ActorContext{ProjectID: "proj_1", Authenticated: true})

	BindFlow(handler, "flow_1")
	JoinCorrelation(handler, "chain_1")

	slot, ok := ActorSlotFromContext(request)
	require.True(t, ok)
	for name, ev := range map[string]*domain.Event{
		"domain event":  FromContext(handler, domain.EventTypeUserCreated, domain.EventCategoryEntity),
		"request event": FromContext(WithActorContext(request, *slot), domain.EventTypeRequestAPI, domain.EventCategoryRequest),
	} {
		require.NotNil(t, ev.FlowID, name)
		assert.Equal(t, "flow_1", *ev.FlowID, name)
		require.NotNil(t, ev.CorrelationID, name)
		assert.Equal(t, "chain_1", *ev.CorrelationID, name)
	}
}

func TestJoinCorrelation_TheFirstCarrierDecides(t *testing.T) {
	ctx := middleware.WithCorrelation(t.Context())
	correlation := middleware.CorrelationFromContext(ctx)

	JoinCorrelation(ctx, "") // a carrier of a time before chains
	assert.Empty(t, correlation.Chain())

	JoinCorrelation(ctx, "chain_1")
	JoinCorrelation(ctx, "chain_2")
	assert.Equal(t, "chain_1", correlation.Chain())

	JoinCorrelation(t.Context(), "chain_1") // outside a request: a no-op
	assert.Nil(t, FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity).CorrelationID)
}

func TestEnsureCorrelation(t *testing.T) {
	t.Run("a request with no chain starts one and stays in it", func(t *testing.T) {
		ctx := middleware.WithCorrelation(t.Context())
		id, err := EnsureCorrelation(ctx)
		require.NoError(t, err)
		assert.Regexp(t, `^corr_[0-9a-f]{32}$`, id)

		again, err := EnsureCorrelation(ctx)
		require.NoError(t, err)
		assert.Equal(t, id, again, "a second carrier of the request is in the same chain")
		ev := FromContext(ctx, domain.EventTypeInvitationCreated, domain.EventCategoryAdmin)
		require.NotNil(t, ev.CorrelationID)
		assert.Equal(t, id, *ev.CorrelationID)
	})
	t.Run("a request in a chain hands it to the carrier it creates", func(t *testing.T) {
		ctx := middleware.WithCorrelation(t.Context())
		JoinCorrelation(ctx, "chain_1")
		id, err := EnsureCorrelation(ctx)
		require.NoError(t, err)
		assert.Equal(t, "chain_1", id)
	})
	t.Run("outside a request the carrier gets a chain of its own", func(t *testing.T) {
		first, err := EnsureCorrelation(t.Context())
		require.NoError(t, err)
		second, err := EnsureCorrelation(t.Context())
		require.NoError(t, err)
		assert.Regexp(t, `^corr_[0-9a-f]{32}$`, first)
		assert.NotEqual(t, first, second)
	})
}

func TestWithPayload(t *testing.T) {
	ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev, err := WithPayload(ev, domain.UserCreatedPayload{SchemaID: "sch_1", AttributeKeys: []string{"email"}})
	require.NoError(t, err)
	assert.Contains(t, string(ev.Payload), "sch_1")
	assert.Contains(t, string(ev.Payload), "email")
}

// TestFromContextCarriesTheAuthorizationMark: Path B events built after the
// authz gate marked the request's slot carry the mark, though the value actor
// was stamped before it (ADR 075 §5).
func TestFromContextCarriesTheAuthorizationMark(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	actor := "user_op"
	ctx = WithActorContext(ctx, ActorContext{ProjectID: "proj_platform", ActorID: &actor})

	plain := FromContext(ctx, domain.EventTypeAuthzGranted, domain.EventCategoryAdmin)
	assert.JSONEq(t, `{}`, string(plain.Metadata))

	MarkAuthorization(ctx, domain.EventAuthorizationMetadata{
		Path:               domain.EventAuthorizationPathPlatformOperator,
		ActorHomeProjectID: "proj_platform",
	})
	marked := FromContext(ctx, domain.EventTypeAuthzGranted, domain.EventCategoryAdmin)
	assert.JSONEq(t, `{"authorization":{"path":"platform_operator","actor_home_project_id":"proj_platform"}}`, string(marked.Metadata))
	assert.Equal(t, &actor, marked.ActorID)
}

// TestMarkAuthorizationWithoutASlotIsANoOp: outside an HTTP request there is no
// request to mark, and nothing to fail.
func TestMarkAuthorizationWithoutASlotIsANoOp(t *testing.T) {
	MarkAuthorization(t.Context(), domain.EventAuthorizationMetadata{Path: domain.EventAuthorizationPathPlatformOperator})
	assert.JSONEq(t, `{}`, string(FromContext(t.Context(), domain.EventTypeAuthzGranted, domain.EventCategoryAdmin).Metadata))
}

// TestMarkAuthorizationReachesPathBWithoutASlot: a server without the request
// event middleware plants no slot. The mark still reaches the request's Path B
// events through the actor the security handler stamped.
func TestMarkAuthorizationReachesPathBWithoutASlot(t *testing.T) {
	actor := "user_op"
	ctx := WithActorContext(t.Context(), ActorContext{ProjectID: "proj_platform", ActorID: &actor})

	MarkAuthorization(ctx, domain.EventAuthorizationMetadata{
		Path:               domain.EventAuthorizationPathPlatformOperator,
		ActorHomeProjectID: "proj_platform",
	})
	ev := FromContext(ctx, domain.EventTypeProjectUpdated, domain.EventCategoryEntity)
	assert.JSONEq(t, `{"authorization":{"path":"platform_operator","actor_home_project_id":"proj_platform"}}`, string(ev.Metadata))
}

// TestWithActorContextKeepsTheMark: re-stamping the actor mid-request keeps
// the mark the request already carries.
func TestWithActorContextKeepsTheMark(t *testing.T) {
	ctx := WithActorContext(WithActorSlot(t.Context()), ActorContext{ProjectID: "proj_platform"})
	MarkAuthorization(ctx, domain.EventAuthorizationMetadata{Path: domain.EventAuthorizationPathPlatformOperator})

	restamped := WithActorContext(ctx, ActorContext{ProjectID: "proj_customer"})
	ev := FromContext(restamped, domain.EventTypeProjectUpdated, domain.EventCategoryEntity)
	assert.JSONEq(t, `{"authorization":{"path":"platform_operator"}}`, string(ev.Metadata))
	require.NotNil(t, AuthorizationFromContext(restamped))
}
