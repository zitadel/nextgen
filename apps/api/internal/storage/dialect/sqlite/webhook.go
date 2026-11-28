package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/webhook"
)

const (
	webhookQuery = `SELECT ` + webhook.Columns + ` FROM webhooks`

	// The insert writes nothing once the project holds the limit. SQLite has
	// one writer, so no other create runs between the count and the insert.
	//
	// The cursor is now: one tick past the newest event stored in the
	// project, and no clock. insertEventStmt stamps every later event of the
	// project at that tick or after, under the one writer's lock, and any id
	// sorts after the empty one: every event stored from here on is past the
	// cursor, and none stored before is.
	createWebhookStmt = `
INSERT INTO webhooks
    (project_id, id, url, description, event_types, enabled, secret, cursor_created_at, cursor_event_id, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6,
    coalesce((SELECT max(created_at) FROM events WHERE project_id = ?1), 0) + 1, '', ?7
WHERE (SELECT count(*) FROM webhooks WHERE project_id = ?1) < ?8`

	// The right-hand sides read the row as it was, so "enabled = 0" is the
	// state before this update: enabling a disabled webhook moves its cursor
	// to now, as createWebhookStmt defines it, and nothing else does.
	updateWebhookStmt = `
UPDATE webhooks SET
    url = coalesce(?3, url),
    description = coalesce(?4, description),
    event_types = coalesce(?5, event_types),
    enabled = coalesce(?6, enabled),
    cursor_created_at = CASE WHEN ?6 AND enabled = 0
        THEN coalesce((SELECT max(created_at) FROM events WHERE project_id = ?1), 0) + 1
        ELSE cursor_created_at END,
    cursor_event_id = CASE WHEN ?6 AND enabled = 0 THEN '' ELSE cursor_event_id END
WHERE project_id = ?1 AND id = ?2
RETURNING ` + webhook.Columns

	deleteWebhookStmt = `DELETE FROM webhooks WHERE project_id = ?1 AND id = ?2`

	// The right-hand sides read the row as it was, so the stored secret
	// becomes the previous one in the same statement.
	rotateWebhookSecretStmt = `
UPDATE webhooks SET
    previous_secret = secret,
    secret = ?3,
    previous_secret_expires_at = ?4
WHERE project_id = ?1 AND id = ?2
RETURNING ` + webhook.Columns
)

type webhookStatements struct{ statement }

func newWebhookStatements(client queryExecutor) webhookStatements {
	return webhookStatements{statement: statement{client: client}}
}

// CreateWebhook implements [service.WebhookStatements].
func (s webhookStatements) CreateWebhook(ctx context.Context, entity *domain.Webhook) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixWebhook); err != nil {
		return err
	}
	eventTypes, err := encodeJSON(entity.EventTypes)
	if err != nil {
		return err
	}
	now := nowUnixNano()
	n, err := execAffected(ctx, s.client, createWebhookStmt,
		entity.ProjectID,
		entity.ID,
		entity.URL,
		entity.Description,
		eventTypes,
		entity.Secret,
		now,
		domain.WebhookProjectLimit,
	)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrWebhookLimitReached()
	}
	if entity.EventTypes == nil {
		entity.EventTypes = []string{}
	}
	entity.Enabled = true
	entity.CreatedAt = timeFromUnixNano(now)
	return nil
}

// GetWebhook implements [service.WebhookStatements].
func (s webhookStatements) GetWebhook(ctx context.Context, projectID, id string) (*domain.Webhook, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, webhookQuery, webhook.ByID(projectID, id), webhook.Schema); err != nil {
		return nil, err
	}
	return s.queryOne(ctx, s.client, compiler.String(), compiler.args...)
}

// ListWebhooks implements [service.WebhookStatements].
func (s webhookStatements) ListWebhooks(ctx context.Context, projectID string, page database.Page[domain.WebhookField]) (*database.ListResult[*domain.Webhook], error) {
	opts := webhook.ListOptions(projectID, page)
	items, nextCursor, err := pagination.Page(opts.Pagination, webhook.Schema, func(limit uint32) ([]*domain.Webhook, error) {
		var compiler statementCompiler
		if err := compileRead(&compiler, webhookQuery, opts.WithLimit(limit), webhook.Schema); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		items, err := collectRows(rows, scanWebhook)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Webhook]{Items: items, NextCursor: nextCursor}, nil
}

// UpdateWebhook implements [service.WebhookStatements].
func (s webhookStatements) UpdateWebhook(ctx context.Context, projectID, id string, update domain.WebhookUpdate) (*domain.Webhook, error) {
	var eventTypes, enabled any
	if update.EventTypes != nil {
		encoded, err := encodeJSON(update.EventTypes)
		if err != nil {
			return nil, err
		}
		eventTypes = encoded
	}
	if update.Enabled != nil {
		enabled = *update.Enabled
	}
	return s.queryOne(ctx, s.client, updateWebhookStmt,
		projectID, id, nullString(update.URL), nullString(update.Description), eventTypes, enabled)
}

// DeleteWebhook implements [service.WebhookStatements].
func (s webhookStatements) DeleteWebhook(ctx context.Context, projectID, id string) error {
	n, err := execAffected(ctx, s.client, deleteWebhookStmt, projectID, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// RotateWebhookSecret implements [service.WebhookStatements].
func (s webhookStatements) RotateWebhookSecret(ctx context.Context, projectID, id, secret string, previousExpiresAt time.Time) (*domain.Webhook, error) {
	return s.queryOne(ctx, s.client, rotateWebhookSecretStmt, projectID, id, secret, previousExpiresAt.UTC().UnixNano())
}

// queryOne runs a statement that returns one webhook, or none when the
// project has no webhook of that id: a *database.NoRowFoundError.
func (s webhookStatements) queryOne(ctx context.Context, client queryExecutor, stmt string, args ...any) (*domain.Webhook, error) {
	rows, err := client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := collectExactlyOneRow(rows, scanWebhook)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanWebhook(rows *sql.Rows) (*domain.Webhook, error) {
	var (
		entity                  domain.Webhook
		eventTypes              string
		enabled                 int64
		previousSecret          sql.NullString
		previousSecretExpiresAt sql.NullInt64
		lastDeliveredAt         sql.NullInt64
		lastErrorAt             sql.NullInt64
		lastErrorStatus         sql.NullInt32
		cursorCreatedAt         int64
		createdAt               int64
	)
	if err := rows.Scan(
		&entity.ID,
		&entity.ProjectID,
		&entity.URL,
		&entity.Description,
		&eventTypes,
		&enabled,
		&entity.Secret,
		&previousSecret,
		&previousSecretExpiresAt,
		&lastDeliveredAt,
		&lastErrorAt,
		&lastErrorStatus,
		&cursorCreatedAt,
		&entity.CursorEventID,
		&createdAt,
	); err != nil {
		return nil, err
	}
	var err error
	if entity.EventTypes, err = decodeJSONStrings(eventTypes); err != nil {
		return nil, err
	}
	entity.Enabled = enabled != 0
	entity.PreviousSecret = nullStringPtr(previousSecret)
	entity.PreviousSecretExpiresAt = nullUnixNanoPtr(previousSecretExpiresAt)
	entity.LastDeliveredAt = nullUnixNanoPtr(lastDeliveredAt)
	entity.LastErrorAt = nullUnixNanoPtr(lastErrorAt)
	if lastErrorStatus.Valid {
		entity.LastErrorStatus = &lastErrorStatus.Int32
	}
	entity.CursorCreatedAt = timeFromUnixNano(cursorCreatedAt)
	entity.CreatedAt = timeFromUnixNano(createdAt)
	return &entity, nil
}

func nullUnixNanoPtr(n sql.NullInt64) *time.Time {
	if !n.Valid {
		return nil
	}
	return new(timeFromUnixNano(n.Int64))
}

var _ service.WebhookStatements = (*webhookStatements)(nil)
