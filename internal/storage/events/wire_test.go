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
