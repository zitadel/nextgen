package audit

import (
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

func TestBindPublicRequest_StampsSlot(t *testing.T) {
	ctx := WithActorSlot(t.Context())
	ctx = middleware.WithRequestIDContext(ctx, "req_flow")
	BindPublicRequest(ctx, "proj_1", "flow_1", "sess_1")

	slot, ok := ActorSlotFromContext(ctx)
	require.True(t, ok)
	assert.Equal(t, "proj_1", slot.ProjectID)
	require.NotNil(t, slot.FlowID)
	assert.Equal(t, "flow_1", *slot.FlowID)
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
	assert.Nil(t, slot.FlowID)
	assert.Nil(t, slot.SessionID)
}

func TestBindPublicRequest_NoSlotIsNoop(t *testing.T) {
	BindPublicRequest(t.Context(), "proj_1", "flow_1", "sess_1")
}

func TestWithPayload(t *testing.T) {
	ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev, err := WithPayload(ev, domain.UserCreatedPayload{SchemaID: "sch_1", AttributeKeys: []string{"email"}})
	require.NoError(t, err)
	assert.Contains(t, string(ev.Payload), "sch_1")
	assert.Contains(t, string(ev.Payload), "email")
}
