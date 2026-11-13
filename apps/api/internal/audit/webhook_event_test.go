package audit

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// The body of a delivery is byte for byte what the reference documents: these
// keys in this order, null for a missing actor or entity, {} for no payload,
// and none of the event's other columns.
func TestMarshalWebhookEvent(t *testing.T) {
	t.Parallel()
	createdAt := time.Date(2026, 11, 11, 11, 0, 0, 0, time.FixedZone("CET", 3600))
	full := func() *domain.Event {
		return &domain.Event{
			ID:             "evt_1",
			ProjectID:      "proj_abc",
			EventType:      domain.EventTypeUserCreated,
			Category:       domain.EventCategoryEntity,
			OccurredAt:     createdAt.Add(-time.Second),
			CreatedAt:      createdAt,
			TeamID:         new("team_1"),
			ActorID:        new("user_xyz"),
			ActorType:      new(domain.EventActorTypeHuman),
			EntityType:     new("user"),
			EntityID:       new("user_123"),
			ClientID:       "cli_1",
			TokenID:        "tok_1",
			DelegationType: "direct",
			DelegationID:   "del_1",
			Grantor:        "user_grantor",
			Fingerprint:    "fp_1",
			RequestID:      new("req_1"),
			SessionID:      new("sess_1"),
			FlowID:         new("flow_1"),
			Payload:        json.RawMessage(`{ "schema_id": "sch_1", "attribute_keys": ["email", "name"] }`),
			Metadata:       json.RawMessage(`{"client":{"ip":"203.0.113.7"}}`),
			OccurredAtWait: time.Second,
		}
	}

	tests := []struct {
		name   string
		change func(*domain.Event)
		want   string
	}{
		{
			name:   "actor, entity and payload",
			change: func(*domain.Event) {},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":{"type":"human","id":"user_xyz"},"entity":{"type":"user","id":"user_123"},` +
				`"data":{"schema_id":"sch_1","attribute_keys":["email","name"]}}`,
		},
		{
			name: "no actor",
			change: func(e *domain.Event) {
				e.ActorType, e.ActorID = nil, nil
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":null,"entity":{"type":"user","id":"user_123"},` +
				`"data":{"schema_id":"sch_1","attribute_keys":["email","name"]}}`,
		},
		{
			name: "no entity",
			change: func(e *domain.Event) {
				e.EntityType, e.EntityID = nil, nil
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":{"type":"human","id":"user_xyz"},"entity":null,` +
				`"data":{"schema_id":"sch_1","attribute_keys":["email","name"]}}`,
		},
		{
			name: "no payload",
			change: func(e *domain.Event) {
				e.Payload = nil
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":{"type":"human","id":"user_xyz"},"entity":{"type":"user","id":"user_123"},"data":{}}`,
		},
		{
			name: "a null payload",
			change: func(e *domain.Event) {
				e.Payload = json.RawMessage(`null`)
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":{"type":"human","id":"user_xyz"},"entity":{"type":"user","id":"user_123"},"data":{}}`,
		},
		{
			name: "nothing but the required columns",
			change: func(e *domain.Event) {
				*e = domain.Event{ID: e.ID, ProjectID: e.ProjectID, EventType: e.EventType, CreatedAt: e.CreatedAt}
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":null,"entity":null,"data":{}}`,
		},
		{
			name: "a service actor without a user, an entity type without an ID",
			change: func(e *domain.Event) {
				e.ActorType, e.ActorID = new(domain.EventActorTypeService), nil
				e.EntityID = nil
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00Z","project_id":"proj_abc",` +
				`"actor":{"type":"service","id":null},"entity":{"type":"user","id":null},` +
				`"data":{"schema_id":"sch_1","attribute_keys":["email","name"]}}`,
		},
		{
			name: "created_at keeps its fraction",
			change: func(e *domain.Event) {
				e.CreatedAt = e.CreatedAt.Add(123456 * time.Microsecond)
				e.Payload = nil
			},
			want: `{"id":"evt_1","type":"user.created","created_at":"2026-11-11T10:00:00.123456Z","project_id":"proj_abc",` +
				`"actor":{"type":"human","id":"user_xyz"},"entity":{"type":"user","id":"user_123"},"data":{}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ev := full()
			tt.change(ev)

			got, err := marshalWebhookEvent(ev)
			require.NoError(t, err)
			assert.Equal(t, tt.want, string(got))

			again, err := marshalWebhookEvent(ev)
			require.NoError(t, err)
			assert.Equal(t, string(got), string(again), "the same event gives the same bytes")
		})
	}
}

func TestMarshalWebhookEvent_RejectsABrokenPayload(t *testing.T) {
	t.Parallel()
	_, err := marshalWebhookEvent(&domain.Event{ID: "evt_1", Payload: json.RawMessage(`{"a":`)})
	require.Error(t, err)
}
