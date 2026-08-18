package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestEventToAPI_UserCreated(t *testing.T) {
	t.Parallel()
	actor := domain.EventActorTypeHuman
	entityType := "user"
	entityID := "user_1"
	schemaID := "sch_default"
	payload, err := json.Marshal(domain.UserCreatedPayload{SchemaID: schemaID, AttributeKeys: []string{"email"}})
	require.NoError(t, err)

	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	got, err := eventToAPI(&domain.Event{
		ID:             "evt_1",
		ProjectID:      "proj_1",
		EventType:      domain.EventTypeUserCreated,
		Category:       domain.EventCategoryEntity,
		OccurredAt:     now,
		CreatedAt:      now,
		ActorType:      &actor,
		EntityType:     &entityType,
		EntityID:       &entityID,
		ClientID:       "app_1",
		DelegationType: "direct",
		Payload:        payload,
	})
	require.NoError(t, err)
	require.Equal(t, api.UserCreatedEventEvent, got.Type)
	v, ok := got.GetUserCreatedEvent()
	require.True(t, ok)
	assert.Equal(t, "evt_1", v.ID)
	sid, ok := v.Payload.SchemaID.Get()
	require.True(t, ok)
	assert.Equal(t, schemaID, sid)
	assert.Equal(t, []string{"email"}, v.Payload.AttributeKeys)
}

func TestEventToAPI_EmptyPayload(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	got, err := eventToAPI(&domain.Event{
		ID:         "evt_del",
		ProjectID:  "proj_1",
		EventType:  domain.EventTypeProjectDeleted,
		Category:   domain.EventCategoryEntity,
		OccurredAt: now,
		CreatedAt:  now,
		ClientID:   "app_1",
		Payload:    json.RawMessage(`{}`),
	})
	require.NoError(t, err)
	require.Equal(t, api.ProjectDeletedEventEvent, got.Type)
	v, ok := got.GetProjectDeletedEvent()
	require.True(t, ok)
	assert.Equal(t, "evt_del", v.ID)
}

func TestEventToAPI_RequestAPI(t *testing.T) {
	t.Parallel()
	payload, err := json.Marshal(domain.RequestAPIPayload{
		OperationID:   "listEvents",
		Method:        "GET",
		RouteTemplate: "/events",
		Status:        200,
		DurationMs:    12,
	})
	require.NoError(t, err)
	now := time.Now().UTC()
	got, err := eventToAPI(&domain.Event{
		ID:         "evt_req",
		ProjectID:  "proj_1",
		EventType:  domain.EventTypeRequestAPI,
		Category:   domain.EventCategoryRequest,
		OccurredAt: now,
		CreatedAt:  now,
		ClientID:   "app_1",
		Payload:    payload,
	})
	require.NoError(t, err)
	require.Equal(t, api.RequestAPIEventEvent, got.Type)
	v, ok := got.GetRequestAPIEvent()
	require.True(t, ok)
	assert.Equal(t, "listEvents", v.Payload.OperationID)
	assert.Equal(t, api.RequestAPIPayloadMethodGET, v.Payload.Method)
	assert.EqualValues(t, 200, v.Payload.Status)
}
