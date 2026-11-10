package events

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// MarshalWire encodes a domain event as the documented OpenAPI Event JSON
// shape (snake_case). OccurredAtWait is an insert-only hint and is omitted.
func MarshalWire(e *domain.Event) ([]byte, error) {
	m := map[string]any{
		"id":          e.ID,
		"project_id":  e.ProjectID,
		"event_type":  string(e.EventType),
		"category":    string(e.Category),
		"occurred_at": e.OccurredAt.UTC().Format(time.RFC3339Nano),
		"created_at":  e.CreatedAt.UTC().Format(time.RFC3339Nano),
		"client_id":   e.ClientID,
		"payload":     json.RawMessage(NormalizeJSON(e.Payload)),
	}
	if e.TeamID != nil {
		m["team_id"] = *e.TeamID
	}
	if e.ActorID != nil {
		m["actor_id"] = *e.ActorID
	}
	if e.ActorType != nil {
		m["actor_type"] = string(*e.ActorType)
	}
	if e.EntityType != nil {
		m["entity_type"] = *e.EntityType
	}
	if e.EntityID != nil {
		m["entity_id"] = *e.EntityID
	}
	if e.TokenID != "" {
		m["token_id"] = e.TokenID
	}
	if e.DelegationType != "" {
		m["delegation_type"] = e.DelegationType
	}
	if e.DelegationID != "" {
		m["delegation_id"] = e.DelegationID
	}
	if e.Grantor != "" {
		m["grantor"] = e.Grantor
	}
	if e.Fingerprint != "" {
		m["fingerprint"] = e.Fingerprint
	}
	if e.RequestID != nil {
		m["request_id"] = *e.RequestID
	}
	if e.SessionID != nil {
		m["session_id"] = *e.SessionID
	}
	if e.FlowID != nil {
		m["flow_id"] = *e.FlowID
	}
	meta := NormalizeJSON(e.Metadata)
	if len(meta) > 0 && string(meta) != "{}" && string(meta) != "null" {
		m["metadata"] = json.RawMessage(meta)
	}
	return json.Marshal(m)
}
