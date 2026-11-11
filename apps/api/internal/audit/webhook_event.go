package audit

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// webhookEvent is the body of a delivery to a project's webhook: a fixed
// subset of the event, every key always present. It is the customers'
// contract, apart from the event as getEvent returns it (events.MarshalWire),
// which the operator's export sinks still receive. The field order is the
// order of the keys on the wire.
type webhookEvent struct {
	ID        string           `json:"id"`
	Type      string           `json:"type"`
	CreatedAt string           `json:"created_at"`
	ProjectID string           `json:"project_id"`
	Actor     *webhookEventRef `json:"actor"`
	Entity    *webhookEventRef `json:"entity"`
	Data      json.RawMessage  `json:"data"`
}

// webhookEventRef names an actor or an entity. An event can hold one half of
// the pair, such as a service actor without a user: the other half is null.
type webhookEventRef struct {
	Type *string `json:"type"`
	ID   *string `json:"id"`
}

// marshalWebhookEvent encodes an event as the body its project's webhooks
// receive. The same event always gives the same bytes, so every retry carries
// the body the first attempt did.
func marshalWebhookEvent(e *domain.Event) ([]byte, error) {
	var actorType *string
	if e.ActorType != nil {
		actorType = new(string(*e.ActorType))
	}
	data := bytes.TrimSpace(e.Payload)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		data = []byte("{}")
	}
	return json.Marshal(webhookEvent{
		ID:        e.ID,
		Type:      string(e.EventType),
		CreatedAt: e.CreatedAt.UTC().Format(time.RFC3339Nano),
		ProjectID: e.ProjectID,
		Actor:     newWebhookEventRef(actorType, e.ActorID),
		Entity:    newWebhookEventRef(e.EntityType, e.EntityID),
		Data:      data,
	})
}

// newWebhookEventRef returns nil, which encodes as null, when the event holds
// neither half.
func newWebhookEventRef(refType, id *string) *webhookEventRef {
	if refType == nil && id == nil {
		return nil
	}
	return &webhookEventRef{Type: refType, ID: id}
}
