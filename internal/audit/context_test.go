package audit

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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

func TestWithPayload(t *testing.T) {
	ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev, err := WithPayload(ev, domain.UserCreatedPayload{UserID: "user_1", SchemaID: "sch_1"})
	require.NoError(t, err)
	assert.Contains(t, string(ev.Payload), "user_1")
}
