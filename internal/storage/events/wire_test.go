package events_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func TestMarshalWire_SnakeCaseOmitsInsertHint(t *testing.T) {
	t.Parallel()
	actor := domain.EventActorTypeHuman
	entityID := "user_1"
	ev := &domain.Event{
		ID:             "evt_1",
		ProjectID:      "proj_1",
		EventType:      domain.EventTypeUserCreated,
		Category:       domain.EventCategoryEntity,
		OccurredAt:     time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		CreatedAt:      time.Date(2026, 1, 2, 3, 4, 6, 0, time.UTC),
		ClientID:       "cli_1",
		ActorType:      &actor,
		EntityID:       &entityID,
		Payload:        json.RawMessage(`{"user_id":"user_1"}`),
		OccurredAtWait: time.Second,
	}

	raw, err := events.MarshalWire(ev)
	require.NoError(t, err)

	var got map[string]any
	require.NoError(t, json.Unmarshal(raw, &got))
	assert.Equal(t, "proj_1", got["project_id"])
	assert.Equal(t, "user.created", got["event_type"])
	assert.NotContains(t, got, "ProjectID")
	assert.NotContains(t, got, "EventType")
	assert.NotContains(t, got, "OccurredAtWait")
}

func TestMarshalWire_IncludesClientMetadata(t *testing.T) {
	t.Parallel()
	ev := &domain.Event{
		ID:         "evt_req",
		ProjectID:  "proj_1",
		EventType:  domain.EventTypeRequestAPI,
		Category:   domain.EventCategoryRequest,
		OccurredAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		CreatedAt:  time.Date(2026, 1, 2, 3, 4, 6, 0, time.UTC),
		ClientID:   "cli_1",
		Payload:    json.RawMessage(`{"operation_id":"listEvents","method":"GET","route_template":"/events","status":200,"duration_ms":1}`),
		Metadata:   json.RawMessage(`{"client":{"ip":"203.0.113.9","user_agent":"Mozilla/5.0 (test)","origin":"https://app.example.com"}}`),
	}

	raw, err := events.MarshalWire(ev)
	require.NoError(t, err)

	var got map[string]any
	require.NoError(t, json.Unmarshal(raw, &got))
	meta, ok := got["metadata"].(map[string]any)
	require.True(t, ok)
	client, ok := meta["client"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "203.0.113.9", client["ip"])
	assert.Equal(t, "Mozilla/5.0 (test)", client["user_agent"])
	assert.Equal(t, "https://app.example.com", client["origin"])
}
