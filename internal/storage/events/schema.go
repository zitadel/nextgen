package events

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds event list/filter/order fields for all dialects.
var Schema = database.NewSchema(map[domain.EventField]database.FieldBinding[domain.Event]{
	domain.EventFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(e *domain.Event) any { return e.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldID: {
		SQLName:  "id",
		Accessor: func(e *domain.Event) any { return e.ID },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldEventType: {
		SQLName:  "event_type",
		Accessor: func(e *domain.Event) any { return string(e.EventType) },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldCategory: {
		SQLName:  "category",
		Accessor: func(e *domain.Event) any { return string(e.Category) },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldOccurredAt: {
		SQLName:  "occurred_at",
		Accessor: func(e *domain.Event) any { return e.OccurredAt },
		Coerce:   database.CoerceTime,
	},
	domain.EventFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(e *domain.Event) any { return e.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.EventFieldTeamID: {
		SQLName:  "team_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.TeamID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldActorID: {
		SQLName:  "actor_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.ActorID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldActorType: {
		SQLName: "actor_type",
		Accessor: func(e *domain.Event) any {
			if e.ActorType == nil {
				return nil
			}
			return string(*e.ActorType)
		},
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldEntityType: {
		SQLName:  "entity_type",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.EntityType) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldEntityID: {
		SQLName:  "entity_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.EntityID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldClientID: {
		SQLName:  "client_id",
		Accessor: func(e *domain.Event) any { return e.ClientID },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldTokenID: {
		SQLName:  "token_id",
		Accessor: func(e *domain.Event) any { return e.TokenID },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldFingerprint: {
		SQLName:  "fingerprint",
		Accessor: func(e *domain.Event) any { return e.Fingerprint },
		Coerce:   database.CoerceString,
	},
	domain.EventFieldRequestID: {
		SQLName:  "request_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.RequestID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldSessionID: {
		SQLName:  "session_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.SessionID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.EventFieldFlowID: {
		SQLName:  "flow_id",
		Accessor: func(e *domain.Event) any { return database.NullableValue(e.FlowID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
})

// CreatedAtAsc is keyset order (created_at, id) ascending per ADR 027/048.
func CreatedAtAsc() database.OrderBy[domain.EventField] {
	return database.OrderBy[domain.EventField]{
		Columns: []database.Column[domain.EventField]{
			database.Col(domain.EventFieldCreatedAt),
			database.Col(domain.EventFieldID),
		},
		Direction: database.OrderAsc,
	}
}

// ListOptions lists events for a project with keyset pagination on (created_at, id).
func ListOptions(projectID string, limit uint32) *database.ListOptions[domain.EventField] {
	return &database.ListOptions[domain.EventField]{
		Filter: database.Equal(database.Col(domain.EventFieldProjectID), projectID),
		Pagination: database.Page[domain.EventField]{
			Limit:   limit,
			OrderBy: CreatedAtAsc(),
		},
	}
}

func NormalizeJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("{}")
	}
	return raw
}

func MarshalPayload(v any) (json.RawMessage, error) {
	if v == nil {
		return json.RawMessage("{}"), nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	if string(b) == "null" {
		return json.RawMessage("{}"), nil
	}
	return b, nil
}
