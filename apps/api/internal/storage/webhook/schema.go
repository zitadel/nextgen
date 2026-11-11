// Package webhook holds the read plumbing every dialect shares for a
// project's webhooks (ADR 088).
package webhook

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Columns is the select list every dialect reads a webhook with, in the
// order its scan expects.
const Columns = `id, project_id, url, description, event_types, enabled,` +
	` secret, previous_secret, previous_secret_expires_at,` +
	` last_delivered_at, last_error_at, last_error_status,` +
	` cursor_created_at, cursor_event_id, created_at`

// Schema binds the columns of webhooks for all dialects. Lists filter and
// order on project_id, id and created_at only; the other bindings put their
// columns under the nullability check.
var Schema = database.NewSchema(map[domain.WebhookField]database.FieldBinding[domain.Webhook]{
	domain.WebhookFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(w *domain.Webhook) any { return w.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.WebhookFieldID: {
		SQLName:  "id",
		Accessor: func(w *domain.Webhook) any { return w.ID },
		Coerce:   database.CoerceString,
	},
	domain.WebhookFieldURL: {
		SQLName:  "url",
		Accessor: func(w *domain.Webhook) any { return w.URL },
		Coerce:   database.CoerceString,
	},
	domain.WebhookFieldDescription: {
		SQLName:  "description",
		Accessor: func(w *domain.Webhook) any { return w.Description },
		Coerce:   database.CoerceString,
	},
	domain.WebhookFieldEventTypes: {
		SQLName: "event_types",
	},
	domain.WebhookFieldEnabled: {
		SQLName:  "enabled",
		Accessor: func(w *domain.Webhook) any { return w.Enabled },
		Coerce:   database.CoerceBool,
	},
	domain.WebhookFieldSecret: {
		SQLName: "secret",
	},
	domain.WebhookFieldPreviousSecret: {
		SQLName:  "previous_secret",
		Nullable: true,
	},
	domain.WebhookFieldPreviousSecretExpiresAt: {
		SQLName:  "previous_secret_expires_at",
		Accessor: func(w *domain.Webhook) any { return database.NullableValue(w.PreviousSecretExpiresAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.WebhookFieldLastDeliveredAt: {
		SQLName:  "last_delivered_at",
		Accessor: func(w *domain.Webhook) any { return database.NullableValue(w.LastDeliveredAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.WebhookFieldLastErrorAt: {
		SQLName:  "last_error_at",
		Accessor: func(w *domain.Webhook) any { return database.NullableValue(w.LastErrorAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.WebhookFieldLastErrorStatus: {
		SQLName:  "last_error_status",
		Accessor: func(w *domain.Webhook) any { return database.NullableValue(w.LastErrorStatus) },
		Coerce:   database.CoerceNumber[int32],
		Nullable: true,
	},
	domain.WebhookFieldCursorCreatedAt: {
		SQLName: "cursor_created_at",
	},
	domain.WebhookFieldCursorEventID: {
		SQLName: "cursor_event_id",
	},
	domain.WebhookFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(w *domain.Webhook) any { return w.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})

// NewestFirst is created_at DESC, id DESC; id breaks created_at ties.
func NewestFirst() database.OrderBy[domain.WebhookField] {
	return database.OrderBy[domain.WebhookField]{
		Columns: []database.Column[domain.WebhookField]{
			database.Col(domain.WebhookFieldCreatedAt),
			database.Col(domain.WebhookFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ByID filters one webhook of one project.
func ByID(projectID, id string) *database.ListOptions[domain.WebhookField] {
	return &database.ListOptions[domain.WebhookField]{
		Filter: database.And(
			database.Equal(database.Col(domain.WebhookFieldProjectID), projectID),
			database.Equal(database.Col(domain.WebhookFieldID), id),
		),
	}
}

// ListOptions lists a project's webhooks. A page that names no order columns
// takes NewestFirst, direction included.
func ListOptions(projectID string, page database.Page[domain.WebhookField]) *database.ListOptions[domain.WebhookField] {
	if len(page.OrderBy.Columns) == 0 {
		page.OrderBy = NewestFirst()
	}
	return &database.ListOptions[domain.WebhookField]{
		Filter:     database.Equal(database.Col(domain.WebhookFieldProjectID), projectID),
		Pagination: page,
	}
}
