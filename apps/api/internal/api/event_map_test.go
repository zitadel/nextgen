package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
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

func TestEventToAPI_UserUpdated(t *testing.T) {
	t.Parallel()
	actor := domain.EventActorTypeHuman
	entityType := "user"
	entityID := "user_1"
	payload, err := json.Marshal(domain.UserUpdatedPayload{AttributeKeys: []string{"givenName"}})
	require.NoError(t, err)

	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	got, err := eventToAPI(&domain.Event{
		ID:             "evt_upd",
		ProjectID:      "proj_1",
		EventType:      domain.EventTypeUserUpdated,
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
	require.Equal(t, api.UserUpdatedEventEvent, got.Type)
	v, ok := got.GetUserUpdatedEvent()
	require.True(t, ok)
	assert.Equal(t, "evt_upd", v.ID)
	assert.Equal(t, []string{"givenName"}, v.Payload.AttributeKeys)
}

// The invitation payload structs must decode into their generated schemas,
// and a payload missing what its discriminator requires must not.
func TestEventToAPI_InvitationPayloads(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	for _, tc := range []struct {
		name      string
		eventType domain.EventType
		payload   any
		want      api.EventType
		wantErr   bool
	}{
		{"created", domain.EventTypeInvitationCreated, domain.InvitationCreatedPayload{
			Type:                 "project_member",
			ProjectMember:        &domain.InvitationProjectMemberPayload{Relation: "admin"},
			JourneyID:            "journey_1",
			ReplacesInvitationID: "inv_0",
			ExpiresAt:            now.Add(72 * time.Hour),
		}, api.InvitationCreatedEventEvent, false},
		{"accepted", domain.EventTypeInvitationAccepted, domain.InvitationAcceptedPayload{
			Type:       "team_member",
			TeamMember: &domain.InvitationTeamMemberPayload{TeamID: "team_01JD6N8Q0S2U4W6Y8A0C2E4G6J", Role: "member"},
			JourneyID:  "journey_1",
			UserID:     "user_1",
		}, api.InvitationAcceptedEventEvent, false},
		{"accepted without its type's object", domain.EventTypeInvitationAccepted, domain.InvitationAcceptedPayload{
			Type:       "project_member",
			TeamMember: &domain.InvitationTeamMemberPayload{TeamID: "team_01JD6N8Q0S2U4W6Y8A0C2E4G6J", Role: "member"},
			JourneyID:  "journey_1",
			UserID:     "user_1",
		}, "", true},
		{"rejected", domain.EventTypeInvitationRejected, domain.InvitationRejectedPayload{
			JourneyID: "journey_1",
			UserID:    "user_1",
		}, api.InvitationRejectedEventEvent, false},
		{"cancelled", domain.EventTypeInvitationCancelled, domain.InvitationCancelledPayload{
			JourneyID: "journey_1",
			Reason:    domain.InvitationCancelReasonCancelled,
		}, api.InvitationCancelledEventEvent, false},
		{"replaced", domain.EventTypeInvitationCancelled, domain.InvitationCancelledPayload{
			JourneyID:              "journey_1",
			Reason:                 domain.InvitationCancelReasonReplaced,
			ReplacedByInvitationID: "inv_2",
		}, api.InvitationCancelledEventEvent, false},
		{"replaced without the replacement", domain.EventTypeInvitationCancelled, domain.InvitationCancelledPayload{
			JourneyID: "journey_1",
			Reason:    domain.InvitationCancelReasonReplaced,
		}, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			payload, err := json.Marshal(tc.payload)
			require.NoError(t, err)
			entityType := "invitation"
			entityID := "inv_1"
			got, err := eventToAPI(&domain.Event{
				ID:         "evt_inv",
				ProjectID:  "proj_1",
				EventType:  tc.eventType,
				Category:   domain.EventCategoryAdmin,
				OccurredAt: now,
				CreatedAt:  now,
				EntityType: &entityType,
				EntityID:   &entityID,
				ClientID:   "app_1",
				Payload:    payload,
			})
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got.Type)
		})
	}
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

func requestAPIEvent(t *testing.T, metadata json.RawMessage) *domain.Event {
	t.Helper()
	payload, err := json.Marshal(domain.RequestAPIPayload{
		OperationID:   "listEvents",
		Method:        "GET",
		RouteTemplate: "/events",
		Status:        200,
		DurationMs:    12,
	})
	require.NoError(t, err)
	now := time.Now().UTC()
	return &domain.Event{
		ID:         "evt_req",
		ProjectID:  "proj_1",
		EventType:  domain.EventTypeRequestAPI,
		Category:   domain.EventCategoryRequest,
		OccurredAt: now,
		CreatedAt:  now,
		ClientID:   "app_1",
		Payload:    payload,
		Metadata:   metadata,
	}
}

func TestEventToAPI_RequestAPIClientMetadata(t *testing.T) {
	t.Parallel()
	meta, err := json.Marshal(domain.EventMetadata{
		Client: &domain.EventClientMetadata{
			IP:        "203.0.113.9",
			UserAgent: "Mozilla/5.0 (test)",
			Origin:    "https://app.example.com",
		},
	})
	require.NoError(t, err)
	got, err := eventToAPI(requestAPIEvent(t, meta))
	require.NoError(t, err)
	v, ok := got.GetRequestAPIEvent()
	require.True(t, ok)
	md, ok := v.Metadata.Get()
	require.True(t, ok)
	client, ok := md.Client.Get()
	require.True(t, ok)
	ip, ok := client.IP.Get()
	require.True(t, ok)
	assert.Equal(t, "203.0.113.9", ip)
	ua, ok := client.UserAgent.Get()
	require.True(t, ok)
	assert.Equal(t, "Mozilla/5.0 (test)", ua)
	origin, ok := client.Origin.Get()
	require.True(t, ok)
	assert.Equal(t, "https://app.example.com", origin)
}

func TestEventToAPI_RequestAPIMetadataKeepsUnknownKeys(t *testing.T) {
	t.Parallel()
	got, err := eventToAPI(requestAPIEvent(t, json.RawMessage(
		`{"client":{"ip":"203.0.113.9"},"parent_span_id":"abc"}`,
	)))
	require.NoError(t, err)
	v, ok := got.GetRequestAPIEvent()
	require.True(t, ok)
	md, ok := v.Metadata.Get()
	require.True(t, ok)
	client, ok := md.Client.Get()
	require.True(t, ok)
	ip, ok := client.IP.Get()
	require.True(t, ok)
	assert.Equal(t, "203.0.113.9", ip)
	span, ok := md.AdditionalProps["parent_span_id"]
	require.True(t, ok)
	assert.Equal(t, `"abc"`, string(span))
}

// The API writes event times to the millisecond, truncated so a
// `created_after` taken from an event still holds it, and the decode from the
// storage wire takes any fraction.
func TestEventToAPI_TimesToTheMillisecond(t *testing.T) {
	t.Parallel()
	payload, err := json.Marshal(domain.UserCreatedPayload{SchemaID: "sch_default"})
	require.NoError(t, err)
	for name, tc := range map[string]struct {
		occurred, created time.Time
		wantOccurred      string
		wantCreated       string
	}{
		"fraction": {
			occurred:     time.Date(2026, 11, 12, 23, 33, 50, 892_999_999, time.UTC),
			created:      time.Date(2026, 11, 13, 0, 33, 50, 921_345_000, time.FixedZone("CET", 3600)),
			wantOccurred: "2026-11-12T23:33:50.892Z",
			wantCreated:  "2026-11-12T23:33:50.921Z",
		},
		"whole second": {
			occurred:     time.Date(2026, 11, 12, 23, 33, 51, 0, time.UTC),
			created:      time.Date(2026, 11, 12, 23, 33, 51, 400_000_000, time.UTC),
			wantOccurred: "2026-11-12T23:33:51Z",
			wantCreated:  "2026-11-12T23:33:51.4Z",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got, err := eventToAPI(&domain.Event{
				ID:         "evt_ms",
				ProjectID:  "proj_1",
				EventType:  domain.EventTypeUserCreated,
				Category:   domain.EventCategoryEntity,
				OccurredAt: tc.occurred,
				CreatedAt:  tc.created,
				ClientID:   "app_1",
				Payload:    payload,
			})
			require.NoError(t, err)
			raw, err := got.MarshalJSON()
			require.NoError(t, err)
			var wire struct {
				OccurredAt string `json:"occurred_at"`
				CreatedAt  string `json:"created_at"`
			}
			require.NoError(t, json.Unmarshal(raw, &wire))
			assert.Equal(t, tc.wantOccurred, wire.OccurredAt)
			assert.Equal(t, tc.wantCreated, wire.CreatedAt)
		})
	}
}
